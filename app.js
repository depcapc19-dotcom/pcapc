// Pegaso - Core WebRTC & UI Logic
const PEER_ID_PREFIX = "pegaso-";
const CHUNK_SIZE = 32768; // 32KB chunks for high performance
let peer = null;
let activeConnection = null;
let activeCall = null;
let localStream = null;
let activeTransfers = {}; // Stores info for current file transfers

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

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initPeer();
    setupUI();
});

// --- PeerJS Connections Setup ---
function initPeer() {
    // Generate a 6-digit random number for user-friendly ID
    const random6Digit = Math.floor(100000 + Math.random() * 900000);
    const chosenId = random6Digit.toString();

    updateStatusBadge('connecting', 'Inicializando...');

    // Initialize PeerJS on public signaling cloud
    peer = new Peer(chosenId, {
        debug: 1, // Only print warnings/errors to console
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
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
            showToast("Tu ID asignado ya estaba ocupado, regenerando...", "error");
            setTimeout(initPeer, 1500); // Retry with a new random ID
        } else if (err.type === 'peer-not-found') {
            showToast("No se encontró el dispositivo remoto. Revisa el ID.", "error");
            updateStatusBadge('online', 'Listo');
            resetUI();
        } else {
            showToast("Error de conexión: " + err.message, "error");
        }
    });

    // Handle incoming P2P data connection requests
    peer.on('connection', (conn) => {
        if (activeConnection) {
            // Already connected, reject new incoming connections
            conn.on('open', () => {
                conn.send({ type: 'reject', reason: 'Dispositivo ocupado en otra sesión.' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }
        setupConnection(conn);
    });

    // Handle incoming WebRTC screen/video stream call requests
    peer.on('call', (call) => {
        showToast("Recibiendo transmisión de pantalla...", "success");
        activeCall = call;
        
        call.answer(); // Answer the call with empty stream (receiver only)
        
        call.on('stream', (remoteStream) => {
            showRemoteVideo(remoteStream);
        });

        call.on('close', () => {
            hideRemoteVideo();
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
    
    // Set up connection state listeners
    conn.on('open', () => {
        showToast("¡Conexión establecida con éxito!", "success");
        connectedPeerName.innerText = conn.peer;
        
        // Show connection panel & unlock tabs
        activeConnectionPanel.classList.remove('hidden');
        workspaceTabs.classList.remove('locked');
        tabsOverlay.classList.add('hidden');
        updateStatusBadge('online', `Conectado a ${conn.peer}`);
        
        // Clear remote ID input
        peerIdInput.value = '';
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

// --- Connect Outgoing ---
function connectToPeer() {
    const targetId = peerIdInput.value.trim();
    if (!targetId) {
        showToast("Por favor, introduce un ID remoto válido.", "error");
        return;
    }
    
    if (targetId === peer.id) {
        showToast("No puedes conectarte a ti mismo.", "error");
        return;
    }

    updateStatusBadge('connecting', 'Conectando...');
    
    // Connect to target peer
    const conn = peer.connect(targetId, {
        reliable: true
    });
    
    setupConnection(conn);
}

// --- Disconnect Connection ---
function disconnectAll() {
    if (activeConnection) {
        activeConnection.close();
    }
    if (activeCall) {
        activeCall.close();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    resetUI();
    showToast("Te has desconectado.", "info");
}

// --- Reset UI States ---
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
    updateStatusBadge('online', 'Listo');
    
    // Reset file tab elements
    transfersList.innerHTML = '';
    transfersList.appendChild(noTransfersMsg);
    activeTransfers = {};

    // Reset video elements
    hideRemoteVideo();
    btnShareScreen.classList.remove('hidden');
    btnStopShare.classList.add('hidden');
    screenStatusText.innerText = "Pantalla inactiva";
}

// --- Handle Incoming P2P Data Messages ---
function handleIncomingData(msg) {
    if (typeof msg !== 'object' || msg === null) return;

    switch (msg.type) {
        case 'reject':
            showToast(`Conexión rechazada: ${msg.reason}`, "error");
            resetUI();
            break;

        case 'file-header':
            // Prepare receiver for incoming file chunks
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
            // Receive file chunk
            const transfer = activeTransfers[msg.transferId];
            if (!transfer) return;

            transfer.chunks.push(msg.chunk);
            transfer.receivedBytes += msg.chunk.byteLength;
            
            // Calculate progress and update UI
            const percent = (transfer.receivedBytes / transfer.size) * 100;
            const speed = calculateSpeed(transfer.receivedBytes, transfer.startTime);
            updateTransferRowProgress(msg.transferId, percent, transfer.receivedBytes, transfer.size, speed);
            break;

        case 'file-eof':
            // End of File, rebuild blob and trigger download
            const completedTransfer = activeTransfers[msg.transferId];
            if (!completedTransfer) return;

            // Mark completed in UI
            markTransferCompleted(msg.transferId);

            // Reconstruct the full file from binary chunks
            const fileBlob = new Blob(completedTransfer.chunks);
            triggerFileDownload(fileBlob, completedTransfer.name);
            
            showToast(`Archivo recibido: ${completedTransfer.name}`, "success");
            delete activeTransfers[msg.transferId];
            break;

        default:
            console.log("Mensaje desconocido recibido:", msg);
    }
}

// --- File Senders Logic ---
async function handleFileSend(files) {
    if (!activeConnection) {
        showToast("Debes estar conectado a otro dispositivo para enviar archivos.", "error");
        return;
    }

    noTransfersMsg.classList.add('hidden');

    for (let file of files) {
        const transferId = Math.random().toString(36).substring(2, 11);
        createTransferRow(transferId, file.name, file.size, 'sending');
        
        // Start async transmission
        sendFileChunks(transferId, file);
    }
}

async function sendFileChunks(transferId, file) {
    const conn = activeConnection;
    if (!conn) return;

    // Send metadata header
    conn.send({
        type: 'file-header',
        transferId: transferId,
        name: file.name,
        size: file.size
    });

    const startTime = Date.now();
    let offset = 0;
    
    // Set low buffer threshold on the WebRTC data channel for high speeds
    if (conn.dataChannel) {
        conn.dataChannel.bufferedAmountLowThreshold = 65536; // 64KB
    }

    try {
        while (offset < file.size) {
            // Buffer congestion control: prevent browser WebRTC crash
            if (conn.dataChannel && conn.dataChannel.bufferedAmount > 1024 * 1024) { // 1MB Limit
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
            
            // Calculate progress and speed
            const percent = (offset / file.size) * 100;
            const speed = calculateSpeed(offset, startTime);
            updateTransferRowProgress(transferId, percent, offset, file.size, speed);
        }

        // Send End-of-File packet
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

// --- Screen Sharing Logic ---
async function startScreenShare() {
    if (!activeConnection) {
        showToast("Conéctate a un dispositivo antes de compartir pantalla.", "error");
        return;
    }

    try {
        // Request screen capture from browser
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always",
                frameRate: { ideal: 15, max: 30 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            }
        });

        // Toggle UI
        btnShareScreen.classList.add('hidden');
        btnStopShare.classList.remove('hidden');
        screenStatusText.innerText = "Transmitiendo pantalla...";
        showToast("Compartiendo tu pantalla...", "success");

        // Listen for screen sharing stop from native browser UI (e.g. Chrome's floating bar)
        localStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
        };

        // Call the remote peer with the screen media stream
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
    screenStatusText.innerText = "Recibiendo pantalla de la PC remota";
}

function hideRemoteVideo() {
    remoteVideo.style.display = 'none';
    remoteVideo.srcObject = null;
    videoPlaceholder.classList.remove('hidden');
}

// --- UI Helpers & Formatting ---

function updateStatusBadge(state, text) {
    globalStatusBadge.className = 'connection-badge';
    if (state === 'online') {
        globalStatusBadge.classList.add('status-online');
    } else if (state === 'connecting') {
        globalStatusBadge.classList.add('status-connecting');
    } else {
        globalStatusBadge.classList.add('status-offline');
    }
    globalStatusText.innerText = text;
}

function generateQRCode(id) {
    // Generate QR code pointing to this exact app URL with autoconnect param
    const autoConnectUrl = `${window.location.origin}${window.location.pathname}?connect=${id}`;
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(autoConnectUrl)}&color=0a0b1e&bgcolor=ffffff`;
    qrImage.src = qrApiUrl;
}

function checkAutoConnect() {
    // Read ?connect=XXXXXX query parameter from URL for instant connection
    const urlParams = new URLSearchParams(window.location.search);
    const targetConnect = urlParams.get('connect');
    if (targetConnect) {
        peerIdInput.value = targetConnect;
        showToast(`Auto-conectando al ID: ${targetConnect}...`, "info");
        setTimeout(connectToPeer, 1000);
    }
}

function showToast(message, type = 'info') {
    toastMessage.innerText = message;
    toastEl.className = 'toast';
    
    // Set styles depending on status
    if (type === 'error') {
        toastEl.classList.add('toast-error');
        toastIcon.setAttribute('data-lucide', 'alert-circle');
    } else if (type === 'success') {
        toastEl.classList.add('toast-success');
        toastIcon.setAttribute('data-lucide', 'check-circle2');
    } else {
        toastIcon.setAttribute('data-lucide', 'info');
    }
    
    lucide.createIcons(); // Update icons dynamically inside toast
    
    toastEl.classList.remove('hidden');
    
    // Auto-hide after 4 seconds
    clearTimeout(toastEl.timeoutId);
    toastEl.timeoutId = setTimeout(() => {
        toastEl.classList.add('hidden');
    }, 4000);
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
    // Generate hidden download link in browser and click it
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    
    // Cleanup
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
    const duration = (Date.now() - startTime) / 1000; // seconds
    if (duration === 0) return '0 KB/s';
    const bps = bytes / duration; // Bytes per second
    return formatBytes(bps) + '/s';
}

// --- Setup Event Listeners ---
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

    // Toggle QR Code Code
    btnToggleQr.addEventListener('click', () => {
        qrWrapper.classList.toggle('hidden');
        if (qrWrapper.classList.contains('hidden')) {
            btnToggleQr.innerHTML = '<i data-lucide="qr-code"></i> Mostrar Código QR';
        } else {
            btnToggleQr.innerHTML = '<i data-lucide="eye-off"></i> Ocultar Código QR';
        }
        lucide.createIcons();
    });

    // Connect button click
    btnConnect.addEventListener('click', connectToPeer);
    
    // Connect on Enter key
    peerIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            connectToPeer();
        }
    });

    // Disconnect button click
    btnDisconnect.addEventListener('click', disconnectAll);

    // Screen Share button events
    btnShareScreen.addEventListener('click', startScreenShare);
    btnStopShare.addEventListener('click', stopScreenShare);

    // Drag and Drop files zone events
    fileDropZone.addEventListener('click', () => {
        if (!activeConnection) {
            showToast("Primero conéctate a una PC para poder enviar archivos.", "error");
            return;
        }
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSend(e.target.files);
        }
    });

    fileDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileDropZone.classList.add('dragover');
    });

    fileDropZone.addEventListener('dragleave', () => {
        fileDropZone.classList.remove('dragover');
    });

    fileDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        fileDropZone.classList.remove('dragover');
        if (!activeConnection) {
            showToast("Primero conéctate a una PC para poder enviar archivos.", "error");
            return;
        }
        if (e.dataTransfer.files.length > 0) {
            handleFileSend(e.dataTransfer.files);
        }
    });
}
