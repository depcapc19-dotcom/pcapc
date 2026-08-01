// Pegaso - Core WebRTC, Remote Control & Explorer Logic
const PEER_ID_PREFIX = "pegaso-";
const CHUNK_SIZE = 32768; // 32KB chunks for high performance WebRTC transfers
let peer = null;
let activeConnection = null;
let activeCall = null;
let localStream = null;
let activeTransfers = {}; // Stores info for current file transfers
let currentRemoteExplorerPath = "ROOT";
let pendingExplorerCallbacks = {};

// DOM Elements
const myIdEl = document.getElementById('my-id');
const peerIdInput = document.getElementById('peer-id-input');
const btnConnect = document.getElementById('btn-connect');
const btnDisconnect = document.getElementById('btn-disconnect');
const btnCopyId = document.getElementById('btn-copy-id');
const btnToggleQr = document.getElementById('btn-toggle-qr');
const qrWrapper = document.getElementById('qr-wrapper');
const qrImage = document.getElementById('qr-image');
const globalStatusBadge = document.getElementById('global-status-badge');
const globalStatusText = document.getElementById('global-status-text');
const activeConnectionPanel = document.getElementById('active-connection-panel');
const connectedPeerName = document.getElementById('connected-peer-name');
const workspaceTabs = document.getElementById('workspace-tabs');
const tabsOverlay = document.getElementById('tabs-overlay');
const fileDropZone = document.getElementById('file-drop-zone');
const fileInput = document.getElementById('file-input');
const transfersList = document.getElementById('transfers-list');
const noTransfersMsg = document.getElementById('no-transfers-msg');
const btnShareScreen = document.getElementById('btn-share-screen');
const btnStopShare = document.getElementById('btn-stop-share');
const screenStatusText = document.getElementById('screen-status-text');
const remoteVideo = document.getElementById('remote-video');
const videoPlaceholder = document.getElementById('video-placeholder');
const toastEl = document.getElementById('notification-toast');
const toastIcon = document.getElementById('toast-icon');
const toastMessage = document.getElementById('toast-message');

// Remote Control Elements
const btnToggleControl = document.getElementById('btn-toggle-control');
const controlBtnLabel = document.getElementById('control-btn-label');
const controlBadge = document.getElementById('control-badge');
const remoteCursor = document.getElementById('remote-cursor');
const videoContainer = document.getElementById('video-container');
const btnToggleFullscreen = document.getElementById('btn-toggle-fullscreen');
const btnExitFullscreen = document.getElementById('btn-exit-fullscreen');
const fullscreenOverlayBar = document.getElementById('fullscreen-overlay-bar');
let isRemoteControlActive = false;

// Super Features Elements & State (Voice, Recording, Whiteboard, Terminal, QuickActions)
const btnToggleVoice = document.getElementById('btn-toggle-voice');
const btnToggleRecord = document.getElementById('btn-toggle-record');
const btnToggleWhiteboard = document.getElementById('btn-toggle-whiteboard');
const voiceBadge = document.getElementById('voice-badge');
const recordingBadge = document.getElementById('recording-badge');
const quickActionsToolbar = document.getElementById('quick-actions-toolbar');
const whiteboardToolsBar = document.getElementById('whiteboard-tools-bar');
const wbCanvas = document.getElementById('whiteboard-canvas');

let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

let voiceStream = null;
let voiceCall = null;
let isVoiceActive = false;

let isWhiteboardActive = false;
let wbCtx = null;
let wbTool = 'pen';
let wbColor = '#ff3366';
let isWbDrawing = false;
let lastWbPos = { x: 0, y: 0 };

// Saved Devices & History Elements
const savedDevicesList = document.getElementById('saved-devices-list');
const emptySavedMsg = document.getElementById('empty-saved-msg');
const btnSaveCurrent = document.getElementById('btn-save-current');

// Remote File Explorer Elements
const explorerPathInput = document.getElementById('explorer-path-input');
const btnExplorerGo = document.getElementById('btn-explorer-go');
const btnExplorerUp = document.getElementById('btn-explorer-up');
const btnExplorerRefresh = document.getElementById('btn-explorer-refresh');
const btnExplorerMkdir = document.getElementById('btn-explorer-mkdir');
const btnExplorerUpload = document.getElementById('btn-explorer-upload');
const explorerFilePicker = document.getElementById('explorer-file-picker');
const explorerQuickAccess = document.getElementById('explorer-quick-access');
const explorerFilesList = document.getElementById('explorer-files-list');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initPeer();
    setupUI();
    renderSavedDevices();
});

// --- PeerJS Connections Setup ---
function initPeer() {
    const random6Digit = Math.floor(100000 + Math.random() * 900000);
    const chosenId = random6Digit.toString();

    updateStatusBadge('connecting', 'Inicializando...');

    peer = new Peer(chosenId, {
        debug: 1,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        }
    });

    peer.on('open', (id) => {
        myIdEl.innerText = id;
        updateStatusBadge('online', 'Listo');
        generateQRCode(id);
        checkAutoConnect();
    });

    peer.on('error', (err) => {
        console.error("PeerJS Error:", err);
        if (err.type === 'unavailable-id') {
            showToast("ID asignado ocupado, regenerando...", "error");
            setTimeout(initPeer, 1500);
        } else if (err.type === 'peer-not-found') {
            showToast("No se encontró el dispositivo remoto. Revisa el ID.", "error");
            updateStatusBadge('online', 'Listo');
            resetUI();
        } else {
            showToast("Error de conexión: " + err.message, "error");
        }
    });

    peer.on('connection', (conn) => {
        if (activeConnection) {
            conn.on('open', () => {
                conn.send({ type: 'reject', reason: 'Dispositivo ocupado en otra sesión.' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }
        setupConnection(conn);
    });

    peer.on('call', (call) => {
        showToast("Recibiendo transmisión de pantalla...", "success");
        activeCall = call;
        call.answer();
        
        call.on('stream', (remoteStream) => {
            showRemoteVideo(remoteStream);
            switchToScreenTab();
        });

        call.on('close', () => {
            hideRemoteVideo();
            showToast("La transmisión de pantalla ha finalizado.", "info");
        });
        
        call.on('error', (err) => {
            showToast("Error en transmisión de video: " + err.message, "error");
            hideRemoteVideo();
        });
    });
}

// --- Setup Data Connection ---
function setupConnection(conn) {
    activeConnection = conn;
    
    conn.on('open', () => {
        showToast("¡Conexión establecida con éxito!", "success");
        connectedPeerName.innerText = conn.peer;
        
        activeConnectionPanel.classList.remove('hidden');
        workspaceTabs.classList.remove('locked');
        tabsOverlay.classList.add('hidden');
        if (btnSaveCurrent) btnSaveCurrent.style.display = 'inline-block';
        updateStatusBadge('online', `Conectado a ${conn.peer}`);
        
        peerIdInput.value = '';
        saveDeviceToHistory(conn.peer);

        // Cargar explorador remoto al conectar
        fetchRemoteExplorerPath("ROOT");
    });

    conn.on('data', (data) => {
        handleIncomingData(data);
    });

    conn.on('close', () => {
        showToast("El dispositivo remoto se ha desconectado.", "error");
        resetUI();
    });

    conn.on('error', (err) => {
        showToast("Error de conexión: " + err.message, "error");
        resetUI();
    });
}

function connectToPeer(targetIdOverride) {
    const targetId = typeof targetIdOverride === 'string' ? targetIdOverride : peerIdInput.value.trim();
    if (!targetId) {
        showToast("Introduce un ID remoto válido.", "error");
        return;
    }
    
    if (targetId === peer.id) {
        showToast("No puedes conectarte a ti mismo.", "error");
        return;
    }

    updateStatusBadge('connecting', 'Conectando...');
    
    const conn = peer.connect(targetId, { reliable: true });
    setupConnection(conn);
}

function disconnectAll() {
    if (activeConnection) activeConnection.close();
    if (activeCall) activeCall.close();
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    resetUI();
    showToast("Te has desconectado.", "info");
}

function resetUI() {
    activeConnection = null;
    activeCall = null;
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    activeConnectionPanel.classList.add('hidden');
    workspaceTabs.classList.add('locked');
    tabsOverlay.classList.remove('hidden');
    if (btnSaveCurrent) btnSaveCurrent.style.display = 'none';
    updateStatusBadge('online', 'Listo');
    
    transfersList.innerHTML = '';
    transfersList.appendChild(noTransfersMsg);
    activeTransfers = {};

    hideRemoteVideo();
    btnShareScreen.classList.remove('hidden');
    btnStopShare.classList.add('hidden');
    screenStatusText.innerText = "Pantalla inactiva";
}

// --- Handle Incoming Messages (Control + Remote Explorer + P2P) ---
function handleIncomingData(msg) {
    if (typeof msg !== 'object' || msg === null) return;

    switch (msg.type) {
        case 'reject':
            showToast(`Conexión rechazada: ${msg.reason}`, "error");
            resetUI();
            break;

        case 'remote-control-status':
            if (msg.active) {
                showToast("El dispositivo remoto ha activado el control sobre tu pantalla.", "info");
                if (controlBadge) {
                    controlBadge.innerText = "Siendo Controlado";
                    controlBadge.classList.remove('hidden');
                }
            } else {
                showToast("El control remoto ha sido desactivado.", "info");
                if (controlBadge) controlBadge.classList.add('hidden');
                if (remoteCursor) remoteCursor.classList.add('hidden');
            }
            break;

        case 'remote-control':
            handleIncomingRemoteControl(msg);
            break;

        case 'draw-event':
            renderRemoteDrawEvent(msg);
            break;

        case 'clear-whiteboard':
            clearWhiteboardCanvas(false);
            break;

        // Remote Explorer RPC Handling (Host Side)
        case 'explorer-request':
            handleHostExplorerRequest(msg);
            break;

        case 'explorer-response':
            if (pendingExplorerCallbacks[msg.requestId]) {
                pendingExplorerCallbacks[msg.requestId](msg);
                delete pendingExplorerCallbacks[msg.requestId];
            }
            break;

        // P2P Direct Transfer Handling
        case 'file-header':
            const { transferId, name, size } = msg;
            activeTransfers[transferId] = {
                name: name,
                size: size,
                receivedBytes: 0,
                chunks: [],
                startTime: Date.now()
            };
            noTransfersMsg.classList.add('hidden');
            createTransferRow(transferId, name, size, 'receiving');
            break;

        case 'file-chunk':
            const transfer = activeTransfers[msg.transferId];
            if (!transfer) return;

            transfer.chunks.push(msg.chunk);
            transfer.receivedBytes += msg.chunk.byteLength;
            
            const percent = (transfer.receivedBytes / transfer.size) * 100;
            const speed = calculateSpeed(transfer.receivedBytes, transfer.startTime);
            updateTransferRowProgress(msg.transferId, percent, transfer.receivedBytes, transfer.size, speed);
            break;

        case 'file-eof':
            const completedTransfer = activeTransfers[msg.transferId];
            if (!completedTransfer) return;

            markTransferCompleted(msg.transferId);
            const fileBlob = new Blob(completedTransfer.chunks);
            triggerFileDownload(fileBlob, completedTransfer.name);
            showToast(`Archivo recibido: ${completedTransfer.name}`, "success");
            delete activeTransfers[msg.transferId];
            break;

        default:
            console.log("Mensaje recibido:", msg);
    }
}

// --- Remote Control Execution ---
function handleIncomingRemoteControl(msg) {
    if (msg.action === 'mousemove' || msg.action === 'mousedown' || msg.action === 'mouseup' || msg.action === 'click') {
        if (remoteCursor && videoContainer) {
            remoteCursor.classList.remove('hidden');
            const containerRect = videoContainer.getBoundingClientRect();
            const leftPx = msg.xPct * containerRect.width;
            const topPx = msg.yPct * containerRect.height;
            remoteCursor.style.left = `${leftPx}px`;
            remoteCursor.style.top = `${topPx}px`;
        }
    }
    
    // Transmitir al Agente Nativo de Windows (localhost:9999)
    fetch('http://localhost:9999/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg)
    }).catch(() => {
        // Silencioso si el agente nativo no está corriendo
    });
}

function sendRemoteMouseEvent(e, action) {
    if (!isRemoteControlActive || !activeConnection) return;
    const rect = remoteVideo.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width;
    const yPct = (e.clientY - rect.top) / rect.height;

    if (xPct < 0 || xPct > 1 || yPct < 0 || yPct > 1) return;

    activeConnection.send({
        type: 'remote-control',
        action: action,
        xPct: parseFloat(xPct.toFixed(4)),
        yPct: parseFloat(yPct.toFixed(4)),
        button: e.button,
        deltaY: e.deltaY || 0
    });
}

function sendRemoteKeyEvent(e, action) {
    if (!isRemoteControlActive || !activeConnection) return;
    
    // Evitar que combinaciones afecten el navegador local
    if (['Tab', 'Backspace', 'Escape', 'AltGraph'].includes(e.key) || e.ctrlKey || e.altKey) {
        e.preventDefault();
    }

    activeConnection.send({
        type: 'remote-control',
        action: action,
        key: e.key,
        code: e.code,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey
    });
}

function toggleRemoteControl() {
    isRemoteControlActive = !isRemoteControlActive;
    if (isRemoteControlActive) {
        remoteVideo.classList.add('remote-control-active');
        if (controlBtnLabel) controlBtnLabel.innerText = "Desactivar Control";
        if (controlBadge) {
            controlBadge.innerText = "Control Activo";
            controlBadge.classList.remove('hidden');
        }
        remoteVideo.focus();
        showToast("Control remoto nativo activado. Mueve el mouse y escribe con tu teclado.", "success");
    } else {
        remoteVideo.classList.remove('remote-control-active');
        if (controlBtnLabel) controlBtnLabel.innerText = "Activar Control Remoto";
        if (controlBadge) controlBadge.classList.add('hidden');
        showToast("Control remoto desactivado.", "info");
    }

    if (activeConnection) {
        activeConnection.send({
            type: 'remote-control-status',
            active: isRemoteControlActive
        });
    }
}

// --- Remote File Explorer RPC Logic (AnyDesk Style) ---
function sendExplorerRPC(endpoint, payload) {
    return new Promise((resolve) => {
        if (!activeConnection) {
            resolve({ error: "No hay conexión activa con un dispositivo remoto." });
            return;
        }

        const requestId = Math.random().toString(36).substring(2, 11);
        pendingExplorerCallbacks[requestId] = (response) => resolve(response);

        // Timeout de seguridad en caso de que el peer remoto no responda
        setTimeout(() => {
            if (pendingExplorerCallbacks[requestId]) {
                delete pendingExplorerCallbacks[requestId];
                resolve({ error: "Tiempo de espera agotado al conectar con el agente nativo remoto." });
            }
        }, 10000);

        activeConnection.send({
            type: 'explorer-request',
            requestId: requestId,
            endpoint: endpoint,
            payload: payload
        });
    });
}

// Lado del HOST (Recibe la petición del espectador y consulta su agente nativo localhost:9999)
async function handleHostExplorerRequest(msg) {
    const { requestId, endpoint, payload } = msg;

    try {
        if (endpoint === '/files/download') {
            // Manejo especial de descarga directa de archivo nativo
            const res = await fetch(`http://localhost:9999/files/download?path=${encodeURIComponent(payload.path)}`);
            if (!res.ok) throw new Error("Error al leer archivo en PC hospedadora");
            const blob = await res.blob();
            
            // Convertir a ArrayBuffer o Base64 para enviar de vuelta
            const arrayBuffer = await blob.arrayBuffer();
            activeConnection.send({
                type: 'explorer-response',
                requestId: requestId,
                status: 'success',
                fileName: payload.name,
                binaryData: arrayBuffer
            });
            return;
        }

        const res = await fetch(`http://localhost:9999${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
        const result = await res.json();
        
        activeConnection.send({
            type: 'explorer-response',
            requestId: requestId,
            status: 'success',
            data: result
        });
    } catch (err) {
        activeConnection.send({
            type: 'explorer-response',
            requestId: requestId,
            status: 'error',
            error: "Asegúrate de haber ejecutado 'iniciar-control-windows.bat' en la PC remota. (" + err.message + ")"
        });
    }
}

// Renderizado y Navegación del Explorador Remoto
async function fetchRemoteExplorerPath(path) {
    renderExplorerLoading();
    
    const response = await sendExplorerRPC('/files/list', { path: path });

    if (response.error || (response.data && response.data.error)) {
        const errorMsg = response.error || response.data.error;
        showToast(errorMsg, "error");
        renderExplorerError(errorMsg);
        return;
    }

    const data = response.data;
    currentRemoteExplorerPath = data.currentPath;
    explorerPathInput.value = currentRemoteExplorerPath;

    renderExplorerQuickAccess(data.quickAccess || []);
    renderExplorerFilesList(data.items || [], data.parentPath);
}

function renderExplorerLoading() {
    explorerFilesList.innerHTML = `
        <tr>
            <td colspan="5" class="explorer-loading-state">
                <i data-lucide="loader-2" class="spin-icon"></i>
                <p>Cargando carpeta remota...</p>
            </td>
        </tr>
    `;
    lucide.createIcons();
}

function renderExplorerError(msg) {
    explorerFilesList.innerHTML = `
        <tr>
            <td colspan="5" class="explorer-loading-state" style="color: var(--danger);">
                <i data-lucide="alert-triangle" style="width: 32px; height: 32px; margin-bottom: 8px;"></i>
                <p>${msg}</p>
                <button class="btn btn-secondary btn-sm" style="margin-top: 10px;" onclick="fetchRemoteExplorerPath('ROOT')">
                    Ir a Discos Locales
                </button>
            </td>
        </tr>
    `;
    lucide.createIcons();
}

function renderExplorerQuickAccess(quickItems) {
    explorerQuickAccess.innerHTML = '';
    quickItems.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'quick-btn';
        btn.innerHTML = `<i data-lucide="${item.icon || 'folder'}"></i> ${item.name}`;
        btn.onclick = () => fetchRemoteExplorerPath(item.path);
        explorerQuickAccess.appendChild(btn);
    });
    lucide.createIcons();
}

function renderExplorerFilesList(items, parentPath) {
    explorerFilesList.innerHTML = '';

    if (parentPath !== null && parentPath !== undefined) {
        const upRow = document.createElement('tr');
        upRow.className = 'explorer-row is-folder';
        upRow.innerHTML = `
            <td><i data-lucide="corner-left-up" class="item-icon"></i></td>
            <td colspan="4" class="item-name-cell"><strong>.. (Subir nivel)</strong></td>
        `;
        upRow.onclick = () => fetchRemoteExplorerPath(parentPath);
        explorerFilesList.appendChild(upRow);
    }

    if (items.length === 0) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `
            <td colspan="5" class="explorer-loading-state">
                <p>Esta carpeta está vacía.</p>
            </td>
        `;
        explorerFilesList.appendChild(emptyRow);
        lucide.createIcons();
        return;
    }

    items.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = `explorer-row ${item.isDir ? 'is-folder' : ''}`;
        
        let iconName = item.icon || (item.isDir ? 'folder' : 'file');
        let iconClass = item.isDir ? 'folder-icon' : (item.icon === 'hard-drive' ? 'drive-icon' : 'file-icon');

        tr.innerHTML = `
            <td><i data-lucide="${iconName}" class="item-icon ${iconClass}"></i></td>
            <td class="item-name-cell">${item.name}</td>
            <td>${item.isDir ? '--' : formatBytes(item.size)}</td>
            <td>${item.modifiedTime || '--'}</td>
            <td style="text-align: right;">
                <div class="explorer-actions">
                    ${!item.isDir ? `
                        <button class="action-btn-sm" title="Descargar este archivo" onclick="downloadRemoteFile('${encodeURIComponent(item.path)}', '${encodeURIComponent(item.name)}')">
                            <i data-lucide="download"></i>
                        </button>
                    ` : ''}
                    <button class="action-btn-sm delete-btn" title="Eliminar del equipo remoto" onclick="deleteRemoteItem('${encodeURIComponent(item.path)}')">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </td>
        `;

        if (item.isDir) {
            tr.onclick = (e) => {
                if (e.target.closest('.explorer-actions')) return;
                fetchRemoteExplorerPath(item.path);
            };
        }

        explorerFilesList.appendChild(tr);
    });

    lucide.createIcons();
}

async function deleteRemoteItem(encodedPath) {
    const path = decodeURIComponent(encodedPath);
    if (!confirm(`¿Estás seguro de que deseas eliminar permanentemente '${path}' del equipo remoto?`)) {
        return;
    }

    showToast("Eliminando elemento remoto...", "info");
    const res = await sendExplorerRPC('/files/delete', { path: path });

    if (res.error || (res.data && res.data.error)) {
        showToast(res.error || res.data.error, "error");
    } else {
        showToast("Elemento eliminado correctamente.", "success");
        fetchRemoteExplorerPath(currentRemoteExplorerPath);
    }
}

async function createRemoteFolder() {
    const folderName = prompt("Introduce el nombre de la nueva carpeta:");
    if (!folderName || !folderName.trim()) return;

    showToast("Creando carpeta remota...", "info");
    const res = await sendExplorerRPC('/files/mkdir', {
        path: currentRemoteExplorerPath,
        name: folderName.trim()
    });

    if (res.error || (res.data && res.data.error)) {
        showToast(res.error || res.data.error, "error");
    } else {
        showToast("Carpeta creada con éxito.", "success");
        fetchRemoteExplorerPath(currentRemoteExplorerPath);
    }
}

async function downloadRemoteFile(encodedPath, encodedName) {
    const path = decodeURIComponent(encodedPath);
    const name = decodeURIComponent(encodedName);
    showToast(`Descargando ${name} desde equipo remoto...`, "info");

    const res = await sendExplorerRPC('/files/download', { path: path, name: name });

    if (res.error) {
        showToast(res.error, "error");
    } else if (res.binaryData) {
        const fileBlob = new Blob([res.binaryData]);
        triggerFileDownload(fileBlob, name);
        showToast(`Descarga completada: ${name}`, "success");
    }
}

async function uploadFileToRemoteFolder(file) {
    if (!currentRemoteExplorerPath || currentRemoteExplorerPath === "ROOT") {
        showToast("Selecciona una carpeta o disco en el explorador antes de subir.", "error");
        return;
    }

    showToast(`Subiendo ${file.name} a la PC remota...`, "info");

    const reader = new FileReader();
    reader.onload = async () => {
        const base64Data = reader.result.split(',')[1];
        const res = await sendExplorerRPC('/files/upload', {
            targetPath: currentRemoteExplorerPath,
            fileName: file.name,
            base64Data: base64Data
        });

        if (res.error || (res.data && res.data.error)) {
            showToast(res.error || res.data.error, "error");
        } else {
            showToast(`Archivo subido con éxito a ${file.name}`, "success");
            fetchRemoteExplorerPath(currentRemoteExplorerPath);
        }
    };
    reader.readAsDataURL(file);
}

// --- Saved Devices & Connection History Module ("Guardar información") ---
function getSavedDevices() {
    try {
        return JSON.parse(localStorage.getItem('pegaso_saved_devices')) || [];
    } catch {
        return [];
    }
}

function saveDeviceToHistory(id, customAlias = null) {
    let devices = getSavedDevices();
    const existingIndex = devices.findIndex(d => d.id === id);
    
    const aliasName = customAlias || (existingIndex >= 0 ? devices[existingIndex].name : `PC Remota ${id}`);
    
    if (existingIndex >= 0) {
        devices[existingIndex].name = aliasName;
        devices[existingIndex].lastConnected = new Date().toLocaleDateString('es-ES');
    } else {
        devices.unshift({
            id: id,
            name: aliasName,
            lastConnected: new Date().toLocaleDateString('es-ES')
        });
    }

    localStorage.setItem('pegaso_saved_devices', JSON.stringify(devices));
    renderSavedDevices();
}

function removeSavedDevice(id) {
    let devices = getSavedDevices().filter(d => d.id !== id);
    localStorage.setItem('pegaso_saved_devices', JSON.stringify(devices));
    renderSavedDevices();
    showToast("Dispositivo eliminado de la lista guardada.", "info");
}

function renderSavedDevices() {
    const devices = getSavedDevices();
    savedDevicesList.innerHTML = '';

    if (devices.length === 0) {
        savedDevicesList.appendChild(emptySavedMsg);
        return;
    }

    devices.forEach(device => {
        const itemEl = document.createElement('div');
        itemEl.className = 'saved-device-item';
        itemEl.innerHTML = `
            <div class="saved-device-info">
                <span class="saved-device-name" title="${device.name}">${device.name}</span>
                <span class="saved-device-id">ID: ${device.id}</span>
            </div>
            <div class="saved-device-actions">
                <button class="action-btn-sm" title="Conectar rápido" onclick="connectToPeer('${device.id}')">
                    <i data-lucide="zap"></i>
                </button>
                <button class="action-btn-sm delete-btn" title="Eliminar de guardados" onclick="removeSavedDevice('${device.id}')">
                    <i data-lucide="x"></i>
                </button>
            </div>
        `;
        savedDevicesList.appendChild(itemEl);
    });

    lucide.createIcons();
}

// --- Native Windows Agent Helper Functions ---
async function checkNativeAgentStatus() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);

    try {
        const response = await fetch('http://localhost:9999/status', { signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.ok) {
            const data = await response.json();
            return data.status === 'active';
        }
    } catch (err) {
        clearTimeout(timeoutId);
    }
    return false;
}

function triggerAgentBatDownload() {
    const a = document.createElement('a');
    a.href = 'iniciar-control-windows.bat';
    a.download = 'iniciar-control-windows.bat';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// --- Screen Sharing Logic ---
async function startScreenShare() {
    if (!activeConnection) {
        showToast("Conéctate a un dispositivo antes de compartir pantalla.", "error");
        return;
    }

    try {
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "always", frameRate: { ideal: 15, max: 30 } },
            audio: { echoCancellation: true, noiseSuppression: true }
        });

        btnShareScreen.classList.add('hidden');
        btnStopShare.classList.remove('hidden');
        screenStatusText.innerText = "Transmitiendo pantalla...";
        showToast("Compartiendo tu pantalla...", "success");

        // --- Verificación y Descarga Automatizada del Agente Bat Nativo ---
        const isAgentRunning = await checkNativeAgentStatus();
        const nativeBadge = document.getElementById('native-agent-badge');
        const nativeBadgeText = document.getElementById('native-agent-status-text');

        if (isAgentRunning) {
            if (nativeBadge) {
                nativeBadge.classList.remove('hidden', 'offline');
                if (nativeBadgeText) nativeBadgeText.innerText = "Agente Activo";
            }
            showToast("⚡ Agente Nativo Windows detectado y activo (localhost:9999).", "success");
        } else {
            if (nativeBadge) {
                nativeBadge.classList.remove('hidden');
                nativeBadge.classList.add('offline');
                if (nativeBadgeText) nativeBadgeText.innerText = "Agente Pendiente";
            }
            // Disparar descarga automática del .bat
            triggerAgentBatDownload();
            showToast("📥 Descargando 'iniciar-control-windows.bat' automáticamente. Haz clic en el archivo para activar el control de mouse/teclado.", "warning", 8000);
        }

        localStream.getVideoTracks()[0].onended = () => stopScreenShare();

        activeCall = peer.call(activeConnection.peer, localStream);
        activeCall.on('error', (err) => {
            showToast("Error en transmisión de pantalla: " + err.message, "error");
            stopScreenShare();
        });

    } catch (err) {
        console.error("Error al capturar pantalla:", err);
        showToast("Permiso de captura de pantalla denegado.", "error");
    }
}

function stopScreenShare() {
    if (activeCall) {
        activeCall.close();
        activeCall = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    btnShareScreen.classList.remove('hidden');
    btnStopShare.classList.add('hidden');
    screenStatusText.innerText = "Pantalla inactiva";
    showToast("Compartición de pantalla detenida.", "info");
}

function showRemoteVideo(stream) {
    videoPlaceholder.classList.add('hidden');
    remoteVideo.style.display = 'block';
    remoteVideo.srcObject = stream;
    remoteVideo.play().catch(err => console.warn("Autoplay prevenido por navegador:", err));
    screenStatusText.innerText = "Recibiendo pantalla de la PC remota";
    
    if (btnToggleControl) btnToggleControl.classList.remove('hidden');
    if (btnToggleFullscreen) btnToggleFullscreen.classList.remove('hidden');
    if (btnToggleVoice) btnToggleVoice.classList.remove('hidden');
    if (btnToggleRecord) btnToggleRecord.classList.remove('hidden');
    if (btnToggleWhiteboard) btnToggleWhiteboard.classList.remove('hidden');
    if (quickActionsToolbar) quickActionsToolbar.classList.remove('hidden');
}

function hideRemoteVideo() {
    remoteVideo.style.display = 'none';
    remoteVideo.srcObject = null;
    videoPlaceholder.classList.remove('hidden');
    
    if (btnToggleControl) btnToggleControl.classList.add('hidden');
    if (btnToggleFullscreen) btnToggleFullscreen.classList.add('hidden');
    if (btnToggleVoice) btnToggleVoice.classList.add('hidden');
    if (btnToggleRecord) btnToggleRecord.classList.add('hidden');
    if (btnToggleWhiteboard) btnToggleWhiteboard.classList.add('hidden');
    if (quickActionsToolbar) quickActionsToolbar.classList.add('hidden');
    if (whiteboardToolsBar) whiteboardToolsBar.classList.add('hidden');
    if (isRemoteControlActive) toggleRemoteControl();
    if (remoteCursor) remoteCursor.classList.add('hidden');
}

function switchToScreenTab() {
    const screenTabBtn = document.querySelector('[data-tab="tab-screen"]');
    if (screenTabBtn && !screenTabBtn.classList.contains('active')) {
        screenTabBtn.click();
    }
}

// --- P2P Direct File Sender ---
async function handleFileSend(files) {
    if (!activeConnection) {
        showToast("Debes estar conectado para enviar archivos.", "error");
        return;
    }

    noTransfersMsg.classList.add('hidden');

    for (let file of files) {
        const transferId = Math.random().toString(36).substring(2, 11);
        createTransferRow(transferId, file.name, file.size, 'sending');
        sendFileChunks(transferId, file);
    }
}

async function sendFileChunks(transferId, file) {
    const conn = activeConnection;
    if (!conn) return;

    conn.send({
        type: 'file-header',
        transferId: transferId,
        name: file.name,
        size: file.size
    });

    const startTime = Date.now();
    let offset = 0;

    if (conn.dataChannel) {
        conn.dataChannel.bufferedAmountLowThreshold = 65536;
    }

    try {
        while (offset < file.size) {
            if (conn.dataChannel && conn.dataChannel.bufferedAmount > 1024 * 1024) {
                await new Promise(resolve => {
                    conn.dataChannel.onbufferedamountlow = () => {
                        conn.dataChannel.onbufferedamountlow = null;
                        resolve();
                    };
                });
            }

            const blobSlice = file.slice(offset, offset + CHUNK_SIZE);
            const arrayBuffer = await blobSlice.arrayBuffer();

            conn.send({
                type: 'file-chunk',
                transferId: transferId,
                chunk: arrayBuffer
            });

            offset += blobSlice.size;
            const percent = (offset / file.size) * 100;
            const speed = calculateSpeed(offset, startTime);
            updateTransferRowProgress(transferId, percent, offset, file.size, speed);
        }

        conn.send({
            type: 'file-eof',
            transferId: transferId
        });

        markTransferCompleted(transferId);
        showToast(`Archivo enviado: ${file.name}`, "success");

    } catch (err) {
        console.error("Error al enviar archivo:", err);
        showToast(`Error al enviar ${file.name}`, "error");
        markTransferError(transferId);
    }
}

// --- Fullscreen Toggle Logic ---
function toggleFullscreen() {
    if (!videoContainer) return;

    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (videoContainer.requestFullscreen) videoContainer.requestFullscreen();
        else if (videoContainer.webkitRequestFullscreen) videoContainer.webkitRequestFullscreen();
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
}

function handleFullscreenChange() {
    const isFS = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    if (isFS) {
        if (fullscreenOverlayBar) fullscreenOverlayBar.classList.remove('hidden');
        showToast("Modo pantalla completa activado. Presiona ESC para salir.", "info");
    } else {
        if (fullscreenOverlayBar) fullscreenOverlayBar.classList.add('hidden');
    }
}

// --- Super Features: Quick Actions, Session Recording, Voice Chat, Whiteboard & Terminal ---

// 1. Quick Actions System Shortcuts
async function sendQuickAction(cmd) {
    if (!activeConnection) {
        showToast("Conéctate a un dispositivo remoto primero.", "error");
        return;
    }
    showToast(`Ejecutando atajo remoto: ${cmd}...`, "info");
    const res = await sendExplorerRPC('/system/action', { cmd: cmd });
    if (res.error || (res.data && res.data.error)) {
        showToast(res.error || res.data.error, "error");
    } else {
        showToast((res.data && res.data.message) || "Atajo ejecutado correctamente", "success");
    }
}

async function syncClipboard() {
    if (!activeConnection) return;
    const textToCopy = prompt("Escribe o pega el texto que deseas enviar al portapapeles de la PC remota:");
    if (textToCopy !== null && textToCopy.trim()) {
        const res = await sendExplorerRPC('/system/clipboard', { action: 'set', text: textToCopy.trim() });
        if (res.data && res.data.status === 'success') {
            showToast("Texto enviado al portapapeles remoto", "success");
        } else {
            showToast("Error al enviar a portapapeles", "error");
        }
    }
}

// 2. Session Recording (MediaRecorder API)
function toggleSessionRecording() {
    const stream = remoteVideo.srcObject || localStream;
    if (!stream) {
        showToast("No hay flujo de video activo para grabar.", "error");
        return;
    }

    if (!isRecording) {
        try {
            recordedChunks = [];
            let options = { mimeType: 'video/webm;codecs=vp9' };
            try { mediaRecorder = new MediaRecorder(stream, options); }
            catch (e) { mediaRecorder = new MediaRecorder(stream); }

            mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) recordedChunks.push(e.data);
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(recordedChunks, { type: 'video/webm' });
                const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
                triggerFileDownload(blob, `pegaso-sesion-${dateStr}.webm`);
                showToast("Grabación guardada correctamente en tu equipo", "success");
            };

            mediaRecorder.start(1000);
            isRecording = true;
            if (recordingBadge) recordingBadge.classList.remove('hidden');
            const recBtnLabel = document.getElementById('record-btn-label');
            if (recBtnLabel) recBtnLabel.innerText = "Detener Rec";
            showToast("Grabación de sesión iniciada", "success");
        } catch (err) {
            showToast("Error al iniciar grabación: " + err.message, "error");
        }
    } else {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        isRecording = false;
        if (recordingBadge) recordingBadge.classList.add('hidden');
        const recBtnLabel = document.getElementById('record-btn-label');
        if (recBtnLabel) recBtnLabel.innerText = "Grabar";
    }
}

// 3. Live Voice Call (WebRTC Audio Chat)
async function toggleVoiceCall() {
    if (!activeConnection) {
        showToast("Conéctate a un dispositivo para iniciar voz.", "error");
        return;
    }

    if (!isVoiceActive) {
        try {
            voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            voiceCall = peer.call(activeConnection.peer, voiceStream, { metadata: { type: 'voice' } });
            
            voiceCall.on('stream', (remoteVoiceStream) => {
                const audio = new Audio();
                audio.srcObject = remoteVoiceStream;
                audio.play();
                if (voiceBadge) voiceBadge.classList.remove('hidden');
                showToast("Llamada de voz establecida", "success");
            });

            voiceCall.on('close', () => {
                if (voiceBadge) voiceBadge.classList.add('hidden');
                isVoiceActive = false;
            });

            isVoiceActive = true;
            if (voiceBadge) voiceBadge.classList.remove('hidden');
            const voiceBtnLabel = document.getElementById('voice-btn-label');
            if (voiceBtnLabel) voiceBtnLabel.innerText = "Cortar Voz";
        } catch (err) {
            showToast("No se pudo acceder al micrófono: " + err.message, "error");
        }
    } else {
        if (voiceCall) voiceCall.close();
        if (voiceStream) {
            voiceStream.getTracks().forEach(t => t.stop());
            voiceStream = null;
        }
        isVoiceActive = false;
        if (voiceBadge) voiceBadge.classList.add('hidden');
        const voiceBtnLabel = document.getElementById('voice-btn-label');
        if (voiceBtnLabel) voiceBtnLabel.innerText = "Voz";
        showToast("Llamada de voz finalizada", "info");
    }
}

// 4. Interactive Whiteboard (Remote Draw Sync)
function initWhiteboard() {
    if (!wbCanvas) return;
    wbCtx = wbCanvas.getContext('2d');
    resizeWbCanvas();
    window.addEventListener('resize', resizeWbCanvas);

    wbCanvas.addEventListener('mousedown', (e) => {
        if (!isWhiteboardActive) return;
        isWbDrawing = true;
        const rect = wbCanvas.getBoundingClientRect();
        lastWbPos = {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height
        };
    });

    wbCanvas.addEventListener('mousemove', (e) => {
        if (!isWhiteboardActive || !isWbDrawing) return;
        const rect = wbCanvas.getBoundingClientRect();
        const curPos = {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height
        };

        drawWbLine(lastWbPos, curPos, wbTool, wbColor, true);
        lastWbPos = curPos;
    });

    wbCanvas.addEventListener('mouseup', () => isWbDrawing = false);
    wbCanvas.addEventListener('mouseleave', () => isWbDrawing = false);
}

function resizeWbCanvas() {
    if (!wbCanvas || !videoContainer) return;
    const rect = videoContainer.getBoundingClientRect();
    wbCanvas.width = rect.width || 800;
    wbCanvas.height = rect.height || 450;
}

function toggleWhiteboard() {
    isWhiteboardActive = !isWhiteboardActive;
    if (isWhiteboardActive) {
        resizeWbCanvas();
        wbCanvas.classList.remove('pointer-none');
        wbCanvas.classList.add('pointer-auto');
        if (whiteboardToolsBar) whiteboardToolsBar.classList.remove('hidden');
        showToast("Pizarra activada. Dibuja sobre la pantalla.", "info");
    } else {
        wbCanvas.classList.remove('pointer-auto');
        wbCanvas.classList.add('pointer-none');
        if (whiteboardToolsBar) whiteboardToolsBar.classList.add('hidden');
        showToast("Pizarra desactivada.", "info");
    }
}

function drawWbLine(start, end, tool, color, emit = false) {
    if (!wbCtx || !wbCanvas) return;
    const w = wbCanvas.width;
    const h = wbCanvas.height;

    wbCtx.beginPath();
    wbCtx.moveTo(start.x * w, start.y * h);
    wbCtx.lineTo(end.x * w, end.y * h);
    
    if (tool === 'highlighter') {
        wbCtx.strokeStyle = color;
        wbCtx.globalAlpha = 0.4;
        wbCtx.lineWidth = 14;
        wbCtx.lineCap = 'square';
    } else {
        wbCtx.strokeStyle = color;
        wbCtx.globalAlpha = 1.0;
        wbCtx.lineWidth = 4;
        wbCtx.lineCap = 'round';
    }

    wbCtx.stroke();
    wbCtx.globalAlpha = 1.0;

    if (emit && activeConnection) {
        activeConnection.send({
            type: 'draw-event',
            start: start,
            end: end,
            tool: tool,
            color: color
        });
    }
}

function clearWhiteboardCanvas(emit = false) {
    if (!wbCtx || !wbCanvas) return;
    wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
    if (emit && activeConnection) {
        activeConnection.send({ type: 'clear-whiteboard' });
    }
}

function renderRemoteDrawEvent(msg) {
    if (!isWhiteboardActive) toggleWhiteboard();
    drawWbLine(msg.start, msg.end, msg.tool, msg.color, false);
}

// 5. Remote Terminal Console (PowerShell / CMD)
function initTerminal() {
    const termInput = document.getElementById('terminal-input');
    const btnSend = document.getElementById('btn-send-command');
    const btnClear = document.getElementById('btn-clear-terminal');

    if (termInput) {
        termInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendTerminalCommand();
        });
    }

    if (btnSend) btnSend.addEventListener('click', sendTerminalCommand);
    if (btnClear) {
        btnClear.addEventListener('click', () => {
            const out = document.getElementById('terminal-output');
            if (out) out.innerHTML = '<div class="term-line term-sys">PEGASO Terminal Remota - Consola Limpia</div>';
        });
    }
}

async function sendTerminalCommand() {
    const termInput = document.getElementById('terminal-input');
    const out = document.getElementById('terminal-output');
    if (!termInput || !out) return;

    const cmdText = termInput.value.trim();
    if (!cmdText) return;

    const shellRadios = document.getElementsByName('term-shell');
    let shell = 'powershell';
    for (let r of shellRadios) { if (r.checked) shell = r.value; }

    const promptPrefix = shell === 'cmd' ? 'C:\\>' : 'PS>';
    appendTerminalLine('cmd', `${promptPrefix} ${cmdText}`);
    termInput.value = '';

    const res = await sendExplorerRPC('/system/command', { command: cmdText, shell: shell });

    if (res.error) {
        appendTerminalLine('err', res.error);
    } else if (res.data) {
        if (res.data.error) {
            appendTerminalLine('err', res.data.error);
        } else {
            if (res.data.stdout) appendTerminalLine('out', res.data.stdout);
            if (res.data.stderr) appendTerminalLine('err', res.data.stderr);
        }
    }
}

function appendTerminalLine(type, text) {
    const out = document.getElementById('terminal-output');
    if (!out) return;
    const div = document.createElement('div');
    div.className = `term-line term-${type}`;
    div.innerText = text;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;
}

// 6. Drag & Drop Files Direct to Video Screen
function initVideoDragAndDrop() {
    if (!videoContainer) return;

    videoContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    videoContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!activeConnection) {
            showToast("Conéctate primero para enviar archivos.", "error");
            return;
        }
        if (e.dataTransfer.files.length > 0) {
            showToast("Subiendo archivo arrastrado a la PC remota...", "info");
            for (let file of e.dataTransfer.files) {
                uploadFileToRemoteFolder(file);
            }
        }
    });
}

// --- UI Helpers & Event Listeners ---
function updateStatusBadge(state, text) {
    globalStatusBadge.className = 'connection-badge';
    if (state === 'online') globalStatusBadge.classList.add('status-online');
    else if (state === 'connecting') globalStatusBadge.classList.add('status-connecting');
    else globalStatusBadge.classList.add('status-offline');
    globalStatusText.innerText = text;
}

function generateQRCode(id) {
    const autoConnectUrl = `${window.location.origin}${window.location.pathname}?connect=${id}`;
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(autoConnectUrl)}&color=0a0b1e&bgcolor=ffffff`;
    qrImage.src = qrApiUrl;
}

function checkAutoConnect() {
    const urlParams = new URLSearchParams(window.location.search);
    const targetConnect = urlParams.get('connect');
    if (targetConnect) {
        peerIdInput.value = targetConnect;
        showToast(`Auto-conectando al ID: ${targetConnect}...`, "info");
        setTimeout(connectToPeer, 1000);
    }
}

function showToast(message, type = 'info', duration = 4000) {
    toastMessage.innerText = message;
    toastEl.className = 'toast';
    
    if (type === 'error') {
        toastEl.classList.add('toast-error');
        toastIcon.setAttribute('data-lucide', 'alert-circle');
    } else if (type === 'success') {
        toastEl.classList.add('toast-success');
        toastIcon.setAttribute('data-lucide', 'check-circle2');
    } else if (type === 'warning') {
        toastEl.classList.add('toast-warning');
        toastIcon.setAttribute('data-lucide', 'alert-triangle');
    } else {
        toastIcon.setAttribute('data-lucide', 'info');
    }
    
    lucide.createIcons();
    toastEl.classList.remove('hidden');
    
    clearTimeout(toastEl.timeoutId);
    toastEl.timeoutId = setTimeout(() => toastEl.classList.add('hidden'), duration);
}

function createTransferRow(id, filename, size, direction) {
    const isSending = direction === 'sending';
    const statusText = isSending ? 'Enviando' : 'Recibiendo';
    const badgeClass = isSending ? 'status-sending' : 'status-receiving';
    
    const rowHtml = `
        <div class="transfer-item" id="transfer-${id}">
            <div class="transfer-info">
                <span class="transfer-name" title="${filename}">${filename}</span>
                <span class="transfer-status ${badgeClass}" id="transfer-badge-${id}">${statusText}</span>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar-fill" id="transfer-bar-${id}"></div>
            </div>
            <div class="transfer-stats">
                <span id="transfer-progress-text-${id}">0% de ${formatBytes(size)}</span>
                <span id="transfer-speed-${id}">0 KB/s</span>
            </div>
        </div>
    `;
    transfersList.insertAdjacentHTML('afterbegin', rowHtml);
}

function updateTransferRowProgress(id, percent, current, total, speed) {
    const progressBar = document.getElementById(`transfer-bar-${id}`);
    const progressText = document.getElementById(`transfer-progress-text-${id}`);
    const speedText = document.getElementById(`transfer-speed-${id}`);
    
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressText) progressText.innerText = `${Math.round(percent)}% de ${formatBytes(total)}`;
    if (speedText) speedText.innerText = speed;
}

function markTransferCompleted(id) {
    const badge = document.getElementById(`transfer-badge-${id}`);
    const progressBar = document.getElementById(`transfer-bar-${id}`);
    const speedText = document.getElementById(`transfer-speed-${id}`);
    
    if (badge) {
        badge.className = 'transfer-status status-completed';
        badge.innerText = 'Completado';
    }
    if (progressBar) progressBar.style.width = '100%';
    if (speedText) speedText.innerText = 'Finalizado';
}

function markTransferError(id) {
    const badge = document.getElementById(`transfer-badge-${id}`);
    if (badge) {
        badge.className = 'transfer-status status-error';
        badge.innerText = 'Error';
    }
}

function triggerFileDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function calculateSpeed(bytes, startTime) {
    const duration = (Date.now() - startTime) / 1000;
    if (duration === 0) return '0 KB/s';
    const bps = bytes / duration;
    return formatBytes(bps) + '/s';
}

function setupUI() {
    // Tab switching
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const targetTab = tab.getAttribute('data-tab');
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(targetTab).classList.add('active');

            if (targetTab === 'tab-explorer' && activeConnection) {
                fetchRemoteExplorerPath(currentRemoteExplorerPath);
            }
        });
    });

    // Copy ID button
    btnCopyId.addEventListener('click', () => {
        const myIdText = myIdEl.innerText;
        if (myIdText && myIdText !== 'Generando...') {
            navigator.clipboard.writeText(myIdText)
                .then(() => showToast("ID copiado al portapapeles", "success"))
                .catch(() => showToast("Error al copiar el ID", "error"));
        }
    });

    // Toggle QR Code
    btnToggleQr.addEventListener('click', () => {
        qrWrapper.classList.toggle('hidden');
        if (qrWrapper.classList.contains('hidden')) {
            btnToggleQr.innerHTML = '<i data-lucide="qr-code"></i> Mostrar Código QR';
        } else {
            btnToggleQr.innerHTML = '<i data-lucide="eye-off"></i> Ocultar Código QR';
        }
        lucide.createIcons();
    });

    // Connect & Disconnect buttons
    btnConnect.addEventListener('click', () => connectToPeer());
    peerIdInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') connectToPeer(); });
    btnDisconnect.addEventListener('click', disconnectAll);

    // Save current active connection
    if (btnSaveCurrent) {
        btnSaveCurrent.addEventListener('click', () => {
            if (!activeConnection) return;
            const alias = prompt("Introduce un nombre o alias para este dispositivo:", `PC Remota ${activeConnection.peer}`);
            if (alias) {
                saveDeviceToHistory(activeConnection.peer, alias.trim());
                showToast("Dispositivo guardado en tu historial.", "success");
            }
        });
    }

    // Remote File Explorer Buttons
    if (btnExplorerGo) {
        btnExplorerGo.addEventListener('click', () => fetchRemoteExplorerPath(explorerPathInput.value.trim()));
        explorerPathInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') fetchRemoteExplorerPath(explorerPathInput.value.trim());
        });
    }

    if (btnExplorerUp) {
        btnExplorerUp.addEventListener('click', () => {
            fetchRemoteExplorerPath(currentRemoteExplorerPath + "\\..");
        });
    }

    if (btnExplorerRefresh) {
        btnExplorerRefresh.addEventListener('click', () => fetchRemoteExplorerPath(currentRemoteExplorerPath));
    }

    if (btnExplorerMkdir) {
        btnExplorerMkdir.addEventListener('click', createRemoteFolder);
    }

    if (btnExplorerUpload && explorerFilePicker) {
        btnExplorerUpload.addEventListener('click', () => explorerFilePicker.click());
        explorerFilePicker.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                uploadFileToRemoteFolder(e.target.files[0]);
            }
        });
    }

    // Screen Share & Remote Control buttons
    btnShareScreen.addEventListener('click', startScreenShare);
    btnStopShare.addEventListener('click', stopScreenShare);
    if (btnToggleControl) btnToggleControl.addEventListener('click', toggleRemoteControl);
    if (btnToggleFullscreen) btnToggleFullscreen.addEventListener('click', toggleFullscreen);
    if (btnExitFullscreen) btnExitFullscreen.addEventListener('click', toggleFullscreen);

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    // Mouse & Keyboard events on remote video element
    if (remoteVideo) {
        remoteVideo.addEventListener('mousemove', (e) => sendRemoteMouseEvent(e, 'mousemove'));
        remoteVideo.addEventListener('mousedown', (e) => sendRemoteMouseEvent(e, 'mousedown'));
        remoteVideo.addEventListener('mouseup', (e) => sendRemoteMouseEvent(e, 'mouseup'));
        remoteVideo.addEventListener('click', (e) => sendRemoteMouseEvent(e, 'click'));
        remoteVideo.addEventListener('dblclick', (e) => sendRemoteMouseEvent(e, 'dblclick'));
        remoteVideo.addEventListener('wheel', (e) => sendRemoteMouseEvent(e, 'wheel'));
        remoteVideo.addEventListener('contextmenu', (e) => {
            if (isRemoteControlActive) e.preventDefault();
            sendRemoteMouseEvent(e, 'contextmenu');
        });
    }

    // Global Key Listening when remote control is active
    window.addEventListener('keydown', (e) => {
        if (isRemoteControlActive) sendRemoteKeyEvent(e, 'keydown');
    });
    window.addEventListener('keyup', (e) => {
        if (isRemoteControlActive) sendRemoteKeyEvent(e, 'keyup');
    });

    // P2P File Drop Zone
    fileDropZone.addEventListener('click', () => {
        if (!activeConnection) {
            showToast("Primero conéctate a una PC para enviar archivos.", "error");
            return;
        }
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFileSend(e.target.files);
    });

    fileDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileDropZone.classList.add('dragover');
    });

    fileDropZone.addEventListener('dragleave', () => fileDropZone.classList.remove('dragover'));

    fileDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        fileDropZone.classList.remove('dragover');
        if (!activeConnection) {
            showToast("Primero conéctate a una PC para enviar archivos.", "error");
            return;
        }
        if (e.dataTransfer.files.length > 0) handleFileSend(e.dataTransfer.files);
    });

    // Super Features UI binding (Voice, Recording, Whiteboard, Quick Actions, Terminal)
    if (btnToggleVoice) btnToggleVoice.addEventListener('click', toggleVoiceCall);
    if (btnToggleRecord) btnToggleRecord.addEventListener('click', toggleSessionRecording);
    if (btnToggleWhiteboard) btnToggleWhiteboard.addEventListener('click', toggleWhiteboard);

    // Quick Actions Buttons
    const qaCad = document.getElementById('qa-ctrl-alt-del');
    const qaLock = document.getElementById('qa-lock');
    const qaDesktop = document.getElementById('qa-desktop');
    const qaStart = document.getElementById('qa-start');
    const qaClipboard = document.getElementById('qa-clipboard');

    if (qaCad) qaCad.addEventListener('click', () => sendQuickAction('ctrl_alt_del'));
    if (qaLock) qaLock.addEventListener('click', () => sendQuickAction('lock_screen'));
    if (qaDesktop) qaDesktop.addEventListener('click', () => sendQuickAction('show_desktop'));
    if (qaStart) qaStart.addEventListener('click', () => sendQuickAction('start_menu'));
    if (qaClipboard) qaClipboard.addEventListener('click', syncClipboard);

    // Whiteboard tool buttons & color picker
    document.querySelectorAll('.wb-tool-btn[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.wb-tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            wbTool = btn.getAttribute('data-tool');
        });
    });

    const wbColorPicker = document.getElementById('wb-color-picker');
    if (wbColorPicker) wbColorPicker.addEventListener('input', (e) => wbColor = e.target.value);

    const wbClear = document.getElementById('wb-clear');
    if (wbClear) wbClear.addEventListener('click', () => clearWhiteboardCanvas(true));

    // Initialize modules
    initWhiteboard();
    initTerminal();
    initVideoDragAndDrop();
}
