export const R6_JOINTS = [
    "RootJoint",
    "Neck",
    "Left Shoulder",
    "Right Shoulder",
    "Left Hip",
    "Right Hip"
];

export const R6_PARTS = [
    "HumanoidRootPart",
    "Torso",
    "Head",
    "Left Arm",
    "Right Arm",
    "Left Leg",
    "Right Leg"
];

export function validateRigSnapshot(rig) {
    if (!rig || rig.rigType !== "R6") {
        throw new Error("Selecciona un rig R6. El animador no acepta R15.");
    }

    if (!rig.joints || typeof rig.joints !== "object") {
        throw new Error("El plugin no envió la estructura de articulaciones del R6.");
    }

    const missing = R6_JOINTS.filter((name) => !rig.joints[name]);
    if (missing.length) {
        throw new Error(`Faltan articulaciones R6: ${missing.join(", ")}`);
    }

    if (!rig.parts || typeof rig.parts !== "object") {
        throw new Error("Falta la descripción de las partes del dummy.");
    }

    const missingParts = R6_PARTS.filter((name) => !rig.parts[name]);
    if (missingParts.length) {
        throw new Error(`Faltan partes R6: ${missingParts.join(", ")}`);
    }

    return {
        rigName: String(rig.rigName || "R6"),
        rigType: "R6",
        joints: Object.fromEntries(R6_JOINTS.map((name) => [name, rig.joints[name]])),
        parts: Object.fromEntries(R6_PARTS.map((name) => [name, rig.parts[name]]))
    };
}

export function validateRigSnapshots(rigs) {
    if (!Array.isArray(rigs) || rigs.length < 1 || rigs.length > 2) {
        throw new Error("Selecciona uno o dos rigs R6 para animarlos.");
    }

    const usedIds = new Set();
    return rigs.map((rig, index) => {
        const snapshot = validateRigSnapshot(rig);
        const rigId = String(rig?.rigId || `R${index + 1}`).slice(0, 32);
        if (!/^[A-Za-z0-9_-]+$/.test(rigId)) {
            throw new Error(`Identificador de rig no válido: ${rigId}`);
        }
        if (usedIds.has(rigId)) {
            throw new Error(`Identificador de rig repetido: ${rigId}`);
        }
        usedIds.add(rigId);
        return { ...snapshot, rigId };
    });
}
