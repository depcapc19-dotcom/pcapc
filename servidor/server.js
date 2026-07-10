const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

// Guardamos los dispositivos conectados
const dispositivos = new Map();

wss.on('connection', (ws) => {
    let miId = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        // 1. Cuando una PC se registra con un ID
        if (data.type === 'registrar') {
            miId = data.id;
            dispositivos.set(miId, ws);
            console.log(`Dispositivo registrado: ${miId}`);
        }

        // 2. Cuando una PC quiere enviar datos a otra para conectar
        if (data.type === 'conectar' || data.type === 'senal') {
            const destinoWs = dispositivos.get(data.destino);
            if (destinoWs) {
                destinoWs.send(JSON.stringify({
                    origen: miId,
                    type: data.type,
                    payload: data.payload
                }));
            }
        }
    });

    ws.on('close', () => {
        if (miId) {
            dispositivos.delete(miId);
            console.log(`Dispositivo desconectado: ${miId}`);
        }
    });
});

console.log('Servidor de Pegaso corriendo en el puerto 8080 🚀');
