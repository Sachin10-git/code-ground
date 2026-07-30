require("../../db/config/env");

const { test, describe, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Y = require("yjs");

const User = require("../../db/models/User");
const Project = require("../../db/models/project");
const File = require("../../models/file");
const CRDTDocument = require("../../db/models/crdtDocument");

const { hydrateDocument, clearHydration } = require("../hydration");
const { getDocument, hasDocument, removeDocument } = require("../yjsManager");
const { saveDocument, loadDocument } = require("../persistenceManager");
const fileService = require("../../services/fileService");

const TIMEOUT = 30000;

let testUser;
let testProject;
const createdFileIds = [];

/* Every test gets its own brand-new File (=> brand-new roomId), so
   tests never collide over yjsManager's shared in-memory maps even
   without perfect cleanup - but we clean up anyway, for hygiene and so
   a failed assertion in one test can't leak state into another. */
async function createTestFile(content = "") {
    const file = await File.create({
        projectId: testProject._id,
        folderId: null,
        name: "hydration-test.txt",
        language: "plaintext",
        content,
        createdBy: testUser._id,
    });
    createdFileIds.push(file._id);
    return file;
}

function teardownRoom(roomId) {
    removeDocument(roomId);
    clearHydration(roomId);
}

before(async () => {
    await mongoose.connect(process.env.MONGODB_URI);

    testUser = await User.create({
        username: `hydration_test_${Date.now()}`,
        email: `hydration_test_${Date.now()}@example.com`,
        password: "not-a-real-hash",
    });

    testProject = await Project.create({
        name: "Hydration Test Project",
        ownerId: testUser._id,
        members: [{ userId: testUser._id, role: "owner" }],
    });
});

after(async () => {
    await File.deleteMany({ _id: { $in: createdFileIds } });
    await CRDTDocument.deleteMany({ roomId: { $in: createdFileIds.map(String) } });
    await Project.findByIdAndDelete(testProject._id);
    await User.findByIdAndDelete(testUser._id);
    await mongoose.disconnect();
});

describe("hydrateDocument", () => {
    test("first open: seeds a brand-new room from File.content", { timeout: TIMEOUT }, async () => {
        const file = await createTestFile("print('hello from file content')");
        const roomId = file._id.toString();

        const doc = await hydrateDocument(roomId);

        assert.equal(doc.getText("editor").toString(), "print('hello from file content')");
        assert.equal(hasDocument(roomId), true);

        teardownRoom(roomId);
    });

    test("empty document: a legitimately blank file stays empty and is still marked hydrated", { timeout: TIMEOUT }, async () => {
        const file = await createTestFile(""); // default content
        const roomId = file._id.toString();

        const doc = await hydrateDocument(roomId);

        assert.equal(doc.getText("editor").toString(), "");
        assert.equal(hasDocument(roomId), true);

        teardownRoom(roomId);
    });

    test("existing CRDT document: reuses persisted state instead of reseeding from File.content", { timeout: TIMEOUT }, async () => {
        const file = await createTestFile("original file content");
        const roomId = file._id.toString();

        // Simulate a prior collaboration session that already saved
        // different content into CRDTDocument.
        const priorDoc = new Y.Doc();
        priorDoc.getText("editor").insert(0, "content from a prior session");
        await saveDocument(roomId, priorDoc);

        const doc = await hydrateDocument(roomId);

        assert.equal(doc.getText("editor").toString(), "content from a prior session");
        assert.notEqual(doc.getText("editor").toString(), file.content);

        teardownRoom(roomId);
        await CRDTDocument.deleteOne({ roomId });
    });

    test("second open: re-hydrating an already-hydrated room is idempotent", { timeout: TIMEOUT }, async () => {
        const file = await createTestFile("stable content");
        const roomId = file._id.toString();

        const first = await hydrateDocument(roomId);
        const second = await hydrateDocument(roomId);

        assert.equal(first, second); // same Y.Doc instance, not re-seeded
        assert.equal(second.getText("editor").toString(), "stable content");

        teardownRoom(roomId);
    });

    test("simultaneous opens: concurrent hydration for a brand-new room seeds content exactly once", { timeout: TIMEOUT }, async () => {
        const file = await createTestFile("abc");
        const roomId = file._id.toString();

        const [d1, d2, d3] = await Promise.all([
            hydrateDocument(roomId),
            hydrateDocument(roomId),
            hydrateDocument(roomId),
        ]);

        assert.equal(d1, d2);
        assert.equal(d2, d3);
        assert.equal(d1.getText("editor").toString(), "abc"); // not "abcabcabc"

        teardownRoom(roomId);
    });

    test("autosave guard: hasDocument() is false while hydration is in flight, true only after it resolves", { timeout: TIMEOUT }, async () => {
        const file = await createTestFile("guarded content");
        const roomId = file._id.toString();

        const pending = hydrateDocument(roomId);

        // Hydration hasn't resolved yet - a manual save landing right
        // now must see this room as NOT safe to flush.
        assert.equal(hasDocument(roomId), false);

        await pending;

        assert.equal(hasDocument(roomId), true);

        teardownRoom(roomId);
    });

    test("reconnect: teardown + reopen loads the persisted state, not a fresh File.content reseed", { timeout: TIMEOUT }, async () => {
        const file = await createTestFile("initial content");
        const roomId = file._id.toString();

        const doc = await hydrateDocument(roomId);
        doc.transact(() => {
            doc.getText("editor").insert(doc.getText("editor").length, " + live edit");
        });

        // Simulate the room fully closing (last socket leaves): flush
        // to CRDTDocument, then discard the in-memory doc + hydration
        // state, exactly like ROOM_LEAVE/disconnecting do.
        await saveDocument(roomId, doc);
        teardownRoom(roomId);

        // File.content is deliberately NOT updated here, to prove the
        // reconnect prefers the richer CRDTDocument state over it.
        const reconnected = await hydrateDocument(roomId);

        assert.equal(reconnected.getText("editor").toString(), "initial content + live edit");

        teardownRoom(roomId);
        await CRDTDocument.deleteOne({ roomId });
    });

    test("persistence: saveDocument + loadDocument round-trips an edit exactly", { timeout: TIMEOUT }, async () => {
        const roomId = new mongoose.Types.ObjectId().toString();

        const doc = new Y.Doc();
        doc.getText("editor").insert(0, "persisted round trip");
        await saveDocument(roomId, doc);

        const freshDoc = new Y.Doc();
        const loaded = await loadDocument(roomId, freshDoc);

        assert.equal(loaded, true);
        assert.equal(freshDoc.getText("editor").toString(), "persisted round trip");

        await CRDTDocument.deleteOne({ roomId });
    });

    test("hydration failure is not cached: a failed attempt can be retried", { timeout: TIMEOUT }, async () => {
        // An invalid ObjectId string makes File.findById reject, so the
        // pipeline throws instead of silently returning an empty doc.
        const roomId = "not-a-valid-object-id";

        await assert.rejects(() => hydrateDocument(roomId));
        assert.equal(hasDocument(roomId), false);

        teardownRoom(roomId);
    });
});

describe("fileService.updateFileContent CRDT sync", () => {
    test("does not create a CRDTDocument for a room that was never hydrated", { timeout: TIMEOUT }, async () => {
        const file = await createTestFile("v1");
        const roomId = file._id.toString();

        await fileService.updateFileContent(roomId, testUser._id, "v2 saved with no live room");

        const persisted = await CRDTDocument.findOne({ roomId });
        assert.equal(persisted, null);

        const updated = await File.findById(file._id);
        assert.equal(updated.content, "v2 saved with no live room");
    });

    test("replaces (not blindly flushes) a hydrated room's content to match what was just saved", { timeout: TIMEOUT }, async () => {
        const file = await createTestFile("v1");
        const roomId = file._id.toString();

        // Room is live/hydrated, but its in-memory content has drifted
        // from what's about to be saved (simulating the client-side
        // attach-timing gap described in fileService.js).
        await hydrateDocument(roomId);
        const liveDoc = getDocument(roomId);
        liveDoc.transact(() => {
            liveDoc.getText("editor").insert(0, "STALE-PRE-EDIT-CONTENT");
        });

        // Pass the string roomId, not the raw ObjectId - matches how
        // this is really invoked (Express route params are strings),
        // and matters here because hasDocument/getDocument are plain
        // string-keyed lookups with no ObjectId casting.
        await fileService.updateFileContent(roomId, testUser._id, "the real saved content");

        const freshDoc = new Y.Doc();
        await loadDocument(roomId, freshDoc);
        assert.equal(freshDoc.getText("editor").toString(), "the real saved content");

        teardownRoom(roomId);
        await CRDTDocument.deleteOne({ roomId });
    });
});
