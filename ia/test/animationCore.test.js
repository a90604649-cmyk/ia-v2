import test from "node:test";
import assert from "node:assert/strict";
import { parseAnimationLine, buildPreviewPrompt } from "../animationCore.js";
import { R6_JOINTS, R6_PARTS, validateRigSnapshot } from "../r6.js";

test("accepts a valid preview meta event", () => {
    const result = parseAnimationLine(
        '{"type":"meta","name":"Wave","duration":3,"previewFrames":12,"looped":false}',
        "preview"
    );
    assert.equal(result.type, "meta");
    assert.equal(result.duration, 3);
    assert.equal(result.previewFrames, 12);
});

test("rejects a keyframe that omits an R6 joint", () => {
    const joints = Object.fromEntries(
        R6_JOINTS.slice(0, 5).map((name) => [
            name,
            { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
        ])
    );
    assert.throws(() => parseAnimationLine(
        JSON.stringify({ type: "keyframe", time: 0, joints }),
        "preview"
    ), /Right Hip/);
});

test("accepts a complete R6 keyframe", () => {
    const joints = Object.fromEntries(
        R6_JOINTS.map((name) => [
            name,
            { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
        ])
    );
    const result = parseAnimationLine(
        JSON.stringify({ type: "keyframe", time: 0.5, joints }),
        "preview"
    );
    assert.equal(result.time, 0.5);
    assert.equal(Object.keys(result.joints).length, 6);
});

test("rejects a non-R6 rig snapshot", () => {
    assert.throws(() => validateRigSnapshot({ rigType: "R15" }), /R6/);
});

test("validates all seven classic R6 body parts and six joints", () => {
    const rig = {
        rigName: "dummy",
        rigType: "R6",
        parts: Object.fromEntries(R6_PARTS.map((name) => [name, {}])),
        joints: Object.fromEntries(R6_JOINTS.map((name) => [name, {}]))
    };
    const result = validateRigSnapshot(rig);
    assert.equal(result.rigType, "R6");
    assert.equal(Object.keys(result.parts).length, 7);
    assert.equal(Object.keys(result.joints).length, 6);
});

test("preview prompt contains the user's description and forbids the final 20 percent", () => {
    const prompt = buildPreviewPrompt("The character waves slowly", { rigType: "R6" });
    assert.match(prompt, /The character waves slowly/);
    assert.match(prompt, /No emitas el 20% final/);
});
