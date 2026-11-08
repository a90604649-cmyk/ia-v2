import test from "node:test";
import assert from "node:assert/strict";
import {
    parseAnimationLine,
    buildAnimationPrompt,
    getAnimationProgress
} from "../animationCore.js";
import {
    R6_JOINTS,
    R6_PARTS,
    validateRigSnapshot,
    validateRigSnapshots
} from "../r6.js";

function makeRig(rigId = "R1", rigName = "Dummy") {
    return {
        rigId,
        rigName,
        rigType: "R6",
        parts: Object.fromEntries(R6_PARTS.map((name) => [name, {}])),
        joints: Object.fromEntries(R6_JOINTS.map((name) => [name, {}]))
    };
}

function makeJoints() {
    return Object.fromEntries(
        R6_JOINTS.map((name) => [
            name,
            { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
        ])
    );
}

test("accepts full-animation metadata without a preview percentage", () => {
    const result = parseAnimationLine(
        '{"type":"meta","name":"Duo Walk","duration":3,"keyframes":24,"fps":30,"looped":false}'
    );
    assert.equal(result.type, "meta");
    assert.equal(result.duration, 3);
    assert.equal(result.keyframes, 24);
    assert.equal(result.fps, 30);
});

test("accepts RootJoint translation up to 4 studs for jumps", () => {
    const joints = makeJoints();
    joints.RootJoint.y = -2.7;
    const result = parseAnimationLine(
        JSON.stringify({ type: "keyframe", time: 0.7, joints })
    );
    assert.equal(result.joints.RootJoint.y, -2.7);
});

test("still rejects excessive RootJoint translation", () => {
    const joints = makeJoints();
    joints.RootJoint.y = -4.1;
    assert.throws(() => parseAnimationLine(
        JSON.stringify({ type: "keyframe", time: 0.7, joints })
    ), /RootJoint.y/);
});

test("accepts a live action for one R6 joint and a rig id", () => {
    const result = parseAnimationLine(
        '{"type":"joint","time":0.25,"rigId":"R2","joint":"Right Shoulder","pose":{"x":0,"y":0,"z":0,"rx":0,"ry":0,"rz":-45}}'
    );
    assert.equal(result.type, "joint");
    assert.equal(result.rigId, "R2");
    assert.equal(result.joint, "Right Shoulder");
    assert.equal(result.pose.rz, -45);
});

test("defaults the rig id to R1 for single-rig compatibility", () => {
    const result = parseAnimationLine(
        '{"type":"joint","time":0.25,"joint":"Right Shoulder","pose":{"x":0,"y":0,"z":0,"rx":0,"ry":0,"rz":-45}}'
    );
    assert.equal(result.rigId, "R1");
});

test("rejects a live action for a non-R6 joint", () => {
    assert.throws(() => parseAnimationLine(
        '{"type":"joint","time":0.25,"rigId":"R1","joint":"Right Elbow","pose":{"x":0,"y":0,"z":0,"rx":0,"ry":0,"rz":0}}'
    ), /Articulación R6 no válida/);
});

test("accepts a frame boundary marker with rig id", () => {
    const result = parseAnimationLine('{"type":"frame","time":0.5,"rigId":"R2"}');
    assert.equal(result.type, "frame");
    assert.equal(result.time, 0.5);
    assert.equal(result.rigId, "R2");
});

test("accepts the completion marker", () => {
    assert.equal(parseAnimationLine('{"type":"complete"}').type, "complete");
});

test("rejects a keyframe that omits an R6 joint", () => {
    const joints = Object.fromEntries(
        R6_JOINTS.slice(0, 5).map((name) => [
            name,
            { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
        ])
    );
    assert.throws(() => parseAnimationLine(
        JSON.stringify({ type: "keyframe", time: 0, joints })
    ), /Right Hip/);
});

test("accepts a complete R6 keyframe", () => {
    const result = parseAnimationLine(
        JSON.stringify({ type: "keyframe", time: 0.5, joints: makeJoints() })
    );
    assert.equal(result.time, 0.5);
    assert.equal(result.rigId, "R1");
    assert.equal(Object.keys(result.joints).length, 6);
});

test("rejects a non-R6 rig snapshot", () => {
    assert.throws(() => validateRigSnapshot({ rigType: "R15" }), /R6/);
});

test("validates all seven classic R6 body parts and six joints", () => {
    const result = validateRigSnapshot(makeRig());
    assert.equal(result.rigType, "R6");
    assert.equal(Object.keys(result.parts).length, 7);
    assert.equal(Object.keys(result.joints).length, 6);
});

test("accepts exactly two rig snapshots with distinct ids", () => {
    const rigs = validateRigSnapshots([
        makeRig("R1", "DummyA"),
        makeRig("R2", "DummyB")
    ]);
    assert.equal(rigs.length, 2);
    assert.equal(rigs[0].rigId, "R1");
    assert.equal(rigs[1].rigName, "DummyB");
});

test("rejects more than two rigs", () => {
    assert.throws(() => validateRigSnapshots([
        makeRig("R1"), makeRig("R2"), makeRig("R3")
    ]), /uno o dos rigs/i);
});

test("rejects duplicate rig ids", () => {
    assert.throws(() => validateRigSnapshots([
        makeRig("R1", "DummyA"), makeRig("R1", "DummyB")
    ]), /repetido/i);
});

test("builds a synchronized whole-animation prompt for two rigs", () => {
    const prompt = buildAnimationPrompt("Dummy A saluda a Dummy B", [
        makeRig("R1", "DummyA"),
        makeRig("R2", "DummyB")
    ]);
    assert.match(prompt, /Dummy A saluda a Dummy B/);
    assert.match(prompt, /misma línea de tiempo/);
    assert.match(prompt, /R1/);
    assert.match(prompt, /R2/);
    assert.match(prompt, /No hay checkpoint ni pausa al 80%/);
});

test("animation progress reaches 99 before completion and never caps at 79", () => {
    assert.ok(getAnimationProgress(20, 24) > 79);
    assert.equal(getAnimationProgress(24, 24), 99);
});
