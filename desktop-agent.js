/**
 * Pegaso Desktop Agent (Opcional para control completo del Sistema Operativo Windows/macOS)
 * 
 * Por seguridad, un navegador web no puede mover el cursor real de Windows fuera de su pestaña.
 * Si deseas controlar aplicaciones del sistema operativo completo (como AnyDesk / TeamViewer),
 * este pequeño agente Node.js recibe los eventos WebRTC/WebSocket y ejecuta clicks y pulsaciones reales de teclado en el sistema.
 * 
 * Requisitos:
 *  1. Instalar Node.js
 *  2. Instalar la librería robotjs o @nut-tree/nut-js: npm install @nut-tree/nut-js ws
 *  3. Ejecutar: node desktop-agent.js
 */

const { mouse, keyboard, Button, Point } = require("@nut-tree/nut-js");
const WebSocket = require("ws");

// Configurar velocidad de movimiento de mouse fluida
mouse.config.mouseSpeed = 1000;

console.log("🚀 Agente de Control Remoto Pegaso iniciado...");
console.log("Escuchando eventos de control para el sistema operativo...");

async function executeOSCommand(data, screenWidth = 1920, screenHeight = 1080) {
    if (!data || !data.action) return;

    const targetX = Math.round(data.xPct * screenWidth);
    const targetY = Math.round(data.yPct * screenHeight);

    try {
        switch (data.action) {
            case 'mousemove':
                await mouse.setPosition(new Point(targetX, targetY));
                break;
            case 'click':
            case 'mousedown':
                await mouse.setPosition(new Point(targetX, targetY));
                if (data.button === 2) {
                    await mouse.click(Button.RIGHT);
                } else {
                    await mouse.click(Button.LEFT);
                }
                break;
            case 'keydown':
                if (data.key && data.key.length === 1) {
                    await keyboard.type(data.key);
                }
                break;
        }
    } catch (err) {
        console.error("Error al ejecutar comando en SO:", err.message);
    }
}

module.exports = { executeOSCommand };
nn 
