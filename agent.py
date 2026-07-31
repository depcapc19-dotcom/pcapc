import ctypes
import json
import os
import sys
import shutil
import base64
import time
import string
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse, unquote

# Configurar conciencia de DPI para precisión del 100% en pantallas escaladas (Windows 10/11)
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2) # Per-monitor DPI aware
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

user32 = ctypes.windll.user32

# Constantes de Eventos de Mouse (Windows User32)
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_MIDDLEDOWN = 0x0020
MOUSEEVENTF_MIDDLEUP = 0x0040
MOUSEEVENTF_WHEEL = 0x0800

# Mapeo de teclas de control y especiales Win32 VK
VK_CODES = {
    'Backspace': 0x08,
    'Tab': 0x09,
    'Enter': 0x0D,
    'Shift': 0x10,
    'Control': 0x11,
    'Alt': 0x12,
    'Pause': 0x13,
    'CapsLock': 0x14,
    'Escape': 0x1B,
    'Space': 0x20,
    'PageUp': 0x21,
    'PageDown': 0x22,
    'End': 0x23,
    'Home': 0x24,
    'ArrowLeft': 0x25,
    'ArrowUp': 0x26,
    'ArrowRight': 0x27,
    'ArrowDown': 0x28,
    'Insert': 0x2D,
    'Delete': 0x2E,
    'Meta': 0x5B, # Tecla Windows
    'F1': 0x70, 'F2': 0x71, 'F3': 0x72, 'F4': 0x73, 'F5': 0x74, 'F6': 0x75,
    'F7': 0x76, 'F8': 0x77, 'F9': 0x78, 'F10': 0x79, 'F11': 0x7A, 'F12': 0x7B,
}

KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004

def simulate_key(key, code, is_down=True):
    """ Simula pulsaciones de teclas nativas en Windows (Unicode y teclas especiales) """
    # Revisar si es una tecla especial Win32
    vk = None
    if code in VK_CODES:
        vk = VK_CODES[code]
    elif key in VK_CODES:
        vk = VK_CODES[key]
    
    if vk is not None:
        flags = KEYEVENTF_KEYUP if not is_down else 0
        user32.keybd_event(vk, 0, flags, 0)
    else:
        # Enviar caracteres Unicode directos (letras, números, tildes, símbolos)
        if is_down and len(key) == 1:
            char_val = ord(key)
            user32.keybd_event(0, char_val, KEYEVENTF_UNICODE, 0)
            user32.keybd_event(0, char_val, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0)

class PegasoAgentHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Silenciar logs HTTP rutinarios para maximizar rendimiento
        return

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def send_json(self, data, code=200):
        self.send_response(code)
        self.send_cors_headers()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)

        if parsed.path == '/files/download':
            file_path = query.get('path', [''])[0]
            file_path = unquote(file_path)

            if not file_path or not os.path.exists(file_path) or os.path.isdir(file_path):
                self.send_json({"error": "Archivo no encontrado"}, 404)
                return

            try:
                filename = os.path.basename(file_path)
                file_size = os.path.getsize(file_path)
                self.send_response(200)
                self.send_cors_headers()
                self.send_header('Content-Type', 'application/octet-stream')
                self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
                self.send_header('Content-Length', str(file_size))
                self.end_headers()

                with open(file_path, 'rb') as f:
                    shutil.copyfileobj(f, self.wfile)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
            return

        # Status check endpoint
        if parsed.path == '/' or parsed.path == '/status':
            self.send_json({"status": "active", "system": "Windows Native Agent (Pegaso)", "version": "2.0"})
            return

        self.send_json({"error": "Ruta no encontrada"}, 404)

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)

        try:
            msg = json.loads(post_data.decode('utf-8')) if post_data else {}
        except Exception:
            msg = {}

        parsed_path = urlparse(self.path).path

        # 1. Control Remoto de Mouse y Teclado
        if parsed_path == '/control':
            self.execute_control_action(msg)
            self.send_json({"status": "ok"})
            return

        # 2. Explorador de Archivos Remoto: Listar Contenido
        elif parsed_path == '/files/list':
            target_path = msg.get('path', '').strip()
            result = self.list_directory_contents(target_path)
            self.send_json(result)
            return

        # 3. Explorador de Archivos Remoto: Eliminar Archivo o Carpeta
        elif parsed_path == '/files/delete':
            target_path = msg.get('path', '').strip()
            if not target_path or not os.path.exists(target_path):
                self.send_json({"error": "Ruta de archivo no existe"}, 400)
                return

            try:
                if os.path.isdir(target_path):
                    shutil.rmtree(target_path)
                else:
                    os.remove(target_path)
                self.send_json({"status": "success", "message": "Elemento eliminado correctamente"})
            except Exception as e:
                self.send_json({"error": f"No se pudo eliminar: {str(e)}"}, 500)
            return

        # 4. Explorador de Archivos Remoto: Crear Carpeta
        elif parsed_path == '/files/mkdir':
            target_path = msg.get('path', '').strip()
            folder_name = msg.get('name', '').strip()

            if not target_path or not folder_name:
                self.send_json({"error": "Nombre o ruta inválida"}, 400)
                return

            new_folder_full_path = os.path.join(target_path, folder_name)
            try:
                os.makedirs(new_folder_full_path, exist_ok=True)
                self.send_json({"status": "success", "newPath": new_folder_full_path})
            except Exception as e:
                self.send_json({"error": f"Error al crear carpeta: {str(e)}"}, 500)
            return

        # 5. Explorador de Archivos Remoto: Subir Archivo
        elif parsed_path == '/files/upload':
            target_dir = msg.get('targetPath', '').strip()
            file_name = msg.get('fileName', '').strip()
            base64_content = msg.get('base64Data', '')

            if not target_dir or not file_name or not os.path.exists(target_dir):
                self.send_json({"error": "Ruta de destino inválida"}, 400)
                return

            try:
                dest_path = os.path.join(target_dir, file_name)
                binary_data = base64.b64decode(base64_content)
                with open(dest_path, 'wb') as f:
                    f.write(binary_data)
                self.send_json({"status": "success", "savedPath": dest_path})
            except Exception as e:
                self.send_json({"error": f"Error al guardar archivo: {str(e)}"}, 500)
            return

        # 6. Atajos Rápidos de Sistema (Lock, TaskMgr, Ctrl+Alt+Del, etc.)
        elif parsed_path == '/system/action':
            result = self.execute_system_action(msg)
            self.send_json(result)
            return

        # 7. Consola Remota de Comandos (PowerShell / CMD)
        elif parsed_path == '/system/command':
            result = self.execute_system_command(msg)
            self.send_json(result)
            return

        # 8. Sincronización de Portapapeles (Clipboard)
        elif parsed_path == '/system/clipboard':
            result = self.handle_clipboard(msg)
            self.send_json(result)
            return

        self.send_json({"error": "Acción no válida"}, 400)

    def execute_system_action(self, msg):
        cmd = msg.get('cmd', '')
        if cmd == 'lock_screen':
            user32.LockWorkStation()
            return {"status": "success", "message": "Estación de trabajo bloqueada"}
        elif cmd == 'show_desktop':
            user32.keybd_event(0x5B, 0, 0, 0)
            user32.keybd_event(0x44, 0, 0, 0)
            user32.keybd_event(0x44, 0, KEYEVENTF_KEYUP, 0)
            user32.keybd_event(0x5B, 0, KEYEVENTF_KEYUP, 0)
            return {"status": "success", "message": "Escritorio mostrado"}
        elif cmd == 'taskmgr':
            subprocess.Popen(['taskmgr.exe'])
            return {"status": "success", "message": "Administrador de tareas abierto"}
        elif cmd == 'start_menu':
            user32.keybd_event(0x5B, 0, 0, 0)
            user32.keybd_event(0x5B, 0, KEYEVENTF_KEYUP, 0)
            return {"status": "success", "message": "Menú Inicio activado"}
        elif cmd == 'ctrl_alt_del':
            try:
                subprocess.Popen(['taskmgr.exe'])
            except Exception:
                pass
            return {"status": "success", "message": "Atajo de seguridad ejecutado (TaskManager)"}
        return {"error": "Acción no reconocida"}

    def execute_system_command(self, msg):
        command = msg.get('command', '').strip()
        shell_type = msg.get('shell', 'powershell').lower()

        if not command:
            return {"error": "Comando vacío"}

        try:
            if shell_type == 'cmd':
                cmd_args = ['cmd.exe', '/c', command]
            else:
                cmd_args = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]

            proc = subprocess.run(cmd_args, capture_output=True, text=True, timeout=20)
            return {
                "status": "success",
                "stdout": proc.stdout or "",
                "stderr": proc.stderr or "",
                "exitCode": proc.returncode
            }
        except subprocess.TimeoutExpired:
            return {"error": "El comando excedió el tiempo máximo de espera (20s)"}
        except Exception as e:
            return {"error": f"Error al ejecutar comando: {str(e)}"}

    def handle_clipboard(self, msg):
        action = msg.get('action', 'get')
        if action == 'set':
            text = msg.get('text', '')
            try:
                safe_text = text.replace('"', '`"')
                subprocess.run(['powershell.exe', '-NoProfile', '-Command', f'Set-Clipboard -Value "{safe_text}"'], timeout=5)
                return {"status": "success", "message": "Portapapeles remoto actualizado"}
            except Exception as e:
                return {"error": f"Error al escribir portapapeles: {str(e)}"}
        else:
            try:
                proc = subprocess.run(['powershell.exe', '-NoProfile', '-Command', 'Get-Clipboard'], capture_output=True, text=True, timeout=5)
                return {"status": "success", "text": proc.stdout.strip()}
            except Exception as e:
                return {"error": f"Error al leer portapapeles: {str(e)}"}

    def execute_control_action(self, msg):
        action = msg.get('action')
        x_pct = msg.get('xPct', 0)
        y_pct = msg.get('yPct', 0)
        button = msg.get('button', 0)

        # Mapear coordenadas relativas a la resolución nativa exacta de Windows
        screen_w = user32.GetSystemMetrics(0)
        screen_h = user32.GetSystemMetrics(1)
        target_x = int(x_pct * screen_w)
        target_y = int(y_pct * screen_h)

        # Acciones de Mouse
        if action in ('mousemove', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu'):
            user32.SetCursorPos(target_x, target_y)

        if action == 'mousedown':
            if button == 2:
                user32.mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
            elif button == 1:
                user32.mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, 0)
            else:
                user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)

        elif action == 'mouseup':
            if button == 2:
                user32.mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
            elif button == 1:
                user32.mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, 0)
            else:
                user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)

        elif action == 'click':
            if button == 2:
                user32.mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
                user32.mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
            elif button == 1:
                user32.mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, 0)
                user32.mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, 0)
            else:
                user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
                user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)

        elif action == 'dblclick':
            user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
            time.sleep(0.05)
            user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)

        elif action == 'contextmenu':
            user32.mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
            user32.mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)

        elif action == 'wheel':
            delta_y = int(msg.get('deltaY', 0))
            if delta_y != 0:
                # Scroll Windows: valores positivos desplazan hacia arriba, negativos hacia abajo
                scroll_amount = -120 if delta_y > 0 else 120
                user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, scroll_amount, 0)

        # Acciones de Teclado Nativo
        elif action in ('keydown', 'keyup'):
            key = msg.get('key', '')
            code = msg.get('code', '')
            is_down = (action == 'keydown')
            simulate_key(key, code, is_down)

    def list_directory_contents(self, path):
        user_home = os.path.expanduser('~')
        desktop_path = os.path.join(user_home, 'Desktop')
        downloads_path = os.path.join(user_home, 'Downloads')
        documents_path = os.path.join(user_home, 'Documents')

        quick_access = [
            {"name": "Escritorio", "path": desktop_path, "isDir": True, "icon": "desktop"},
            {"name": "Descargas", "path": downloads_path, "isDir": True, "icon": "download"},
            {"name": "Documentos", "path": documents_path, "isDir": True, "icon": "file-text"},
            {"name": "Usuario (" + os.path.basename(user_home) + ")", "path": user_home, "isDir": True, "icon": "user"}
        ]

        # Si no hay ruta especificada o es "ROOT" / "DRIVES", mostrar discos del equipo
        if not path or path.upper() in ('ROOT', 'DRIVES'):
            drives = []
            for letter in string.ascii_uppercase:
                drive_path = f"{letter}:\\"
                if os.path.exists(drive_path):
                    drives.append({
                        "name": f"Disco Local ({letter}:)",
                        "path": drive_path,
                        "isDir": True,
                        "size": 0,
                        "modifiedTime": "",
                        "icon": "hard-drive"
                    })
            return {
                "currentPath": "ROOT",
                "parentPath": None,
                "quickAccess": quick_access,
                "items": drives
            }

        # Asegurar ruta válida
        norm_path = os.path.abspath(path)
        if not os.path.exists(norm_path) or not os.path.isdir(norm_path):
            return {"error": "Directorio no encontrado", "currentPath": path, "items": []}

        parent_path = os.path.dirname(norm_path)
        if parent_path == norm_path:
            parent_path = "ROOT"

        items = []
        try:
            with os.scandir(norm_path) as entries:
                for entry in entries:
                    try:
                        stat = entry.stat()
                        is_dir = entry.is_dir()
                        items.append({
                            "name": entry.name,
                            "path": entry.path,
                            "isDir": is_dir,
                            "size": stat.st_size if not is_dir else 0,
                            "modifiedTime": time.strftime('%d/%m/%Y %H:%M', time.localtime(stat.st_mtime)),
                            "icon": "folder" if is_dir else "file"
                        })
                    except Exception:
                        continue
        except Exception as e:
            return {"error": f"Acceso denegado: {str(e)}", "currentPath": norm_path, "items": []}

        # Ordenar: Directorios primero, luego archivos alfabéticamente
        items.sort(key=lambda x: (not x['isDir'], x['name'].lower()))

        return {
            "currentPath": norm_path,
            "parentPath": parent_path,
            "quickAccess": quick_access,
            "items": items
        }

def run():
    port = 9999
    server_address = ('localhost', port)
    httpd = HTTPServer(server_address, PegasoAgentHandler)
    print(f"🚀 PEGASO - Agente Nativo de Control Remoto y Archivos activo en puerto {port}")
    print("Soporte completo: Teclado nativo, Mouse preciso (DPI), Explorador de Archivos y Operaciones Remotas.")
    print("Presiona Ctrl+C para detener.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nAgente detenido.")

if __name__ == '__main__':
    run()
