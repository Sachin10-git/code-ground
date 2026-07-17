const { io } = require("socket.io-client");
const Y = require("yjs");

const socket = io("http://localhost:5000", {
    transports: ["websocket"],
});

socket.on("connect", () => {
    console.log("✅ Connected:", socket.id);

    socket.emit("room:join", "test-room");

    setTimeout(() => {
        const doc = new Y.Doc();
        const text = doc.getText("editor");

        text.insert(0, "Hello from " + socket.id);

        const update = Y.encodeStateAsUpdate(doc);

        console.log("📤 Sending Yjs update...");
        socket.emit("editor:file-change", {
            roomId: "test-room",
            update,
        });
    }, 3000);
});

socket.on("editor:file-updated", ({ socketId, update }) => {
    console.log("📥 Update received from:", socketId);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);

    console.log("Document:", doc.getText("editor").toString());
});

socket.on("editor:document-sync", () => {
    console.log("📄 Initial sync received");
});

socket.on("room:user-left", (users) => {
    console.log("👤 User left");
    console.log("Users:", users);
});