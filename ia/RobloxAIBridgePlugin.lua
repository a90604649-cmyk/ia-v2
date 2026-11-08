local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local TweenService = game:GetService("TweenService")

local BASE_URL = "http://127.0.0.1:3000"
local POLL_INTERVAL = 0.30
local FRAME_TRANSITION_SECONDS = 0.14

local JOINTS = {
    "RootJoint",
    "Neck",
    "Left Shoulder",
    "Right Shoulder",
    "Left Hip",
    "Right Hip"
}

local PARTS = {
    "HumanoidRootPart",
    "Torso",
    "Head",
    "Left Arm",
    "Right Arm",
    "Left Leg",
    "Right Leg"
}

local JOINT_TO_PART = {
    ["RootJoint"] = "Torso",
    ["Neck"] = "Head",
    ["Left Shoulder"] = "Left Arm",
    ["Right Shoulder"] = "Right Arm",
    ["Left Hip"] = "Left Leg",
    ["Right Hip"] = "Right Leg"
}

local toolbar = plugin:CreateToolbar("R6 Live Animator")
local openButton = toolbar:CreateButton(
    "R6 Live Animator",
    "Animar uno o dos Dummys R6 al mismo tiempo con IA",
    ""
)
openButton.ClickableWhenViewportHidden = true

local widgetInfo = DockWidgetPluginGuiInfo.new(
    Enum.InitialDockState.Right,
    true,
    false,
    380,
    560,
    340,
    460
)

local widget = plugin:CreateDockWidgetPluginGui("R6LiveAnimator", widgetInfo)
widget.Title = "R6 Live Animator"

local root = Instance.new("Frame")
root.Name = "Root"
root.Size = UDim2.fromScale(1, 1)
root.BackgroundColor3 = Color3.fromRGB(25, 27, 32)
root.BorderSizePixel = 0
root.Parent = widget

local padding = Instance.new("UIPadding")
padding.PaddingTop = UDim.new(0, 12)
padding.PaddingBottom = UDim.new(0, 12)
padding.PaddingLeft = UDim.new(0, 12)
padding.PaddingRight = UDim.new(0, 12)
padding.Parent = root

local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 9)
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Parent = root

local function makeLabel(text, height, color, bold)
    local label = Instance.new("TextLabel")
    label.Size = UDim2.new(1, 0, 0, height)
    label.BackgroundTransparency = 1
    label.Text = text
    label.TextColor3 = color or Color3.fromRGB(230, 232, 237)
    label.Font = bold and Enum.Font.GothamBold or Enum.Font.Gotham
    label.TextSize = bold and 16 or 12
    label.TextWrapped = true
    label.TextXAlignment = Enum.TextXAlignment.Left
    label.Parent = root
    return label
end

local title = makeLabel("R6 LIVE ANIMATOR", 28, Color3.fromRGB(255, 255, 255), true)
local subtitle = makeLabel(
    "Selecciona uno o dos Dummys R6. La IA los animará en una misma línea de tiempo.",
    42
)

local prompt = Instance.new("TextBox")
prompt.Name = "AnimationDescription"
prompt.Size = UDim2.new(1, 0, 0, 112)
prompt.BackgroundColor3 = Color3.fromRGB(37, 40, 47)
prompt.BorderSizePixel = 0
prompt.ClearTextOnFocus = false
prompt.MultiLine = true
prompt.TextWrapped = true
prompt.TextXAlignment = Enum.TextXAlignment.Left
prompt.TextYAlignment = Enum.TextYAlignment.Top
prompt.Font = Enum.Font.Gotham
prompt.TextSize = 13
prompt.TextColor3 = Color3.fromRGB(245, 246, 248)
prompt.PlaceholderColor3 = Color3.fromRGB(145, 150, 160)
prompt.PlaceholderText = "Ejemplo: Dummy 1 camina hacia Dummy 2, lo saluda y Dummy 2 responde con la mano."
prompt.Text = ""
prompt.Parent = root

local promptPadding = Instance.new("UIPadding")
promptPadding.PaddingTop = UDim.new(0, 8)
promptPadding.PaddingBottom = UDim.new(0, 8)
promptPadding.PaddingLeft = UDim.new(0, 8)
promptPadding.PaddingRight = UDim.new(0, 8)
promptPadding.Parent = prompt

local selectedRigLabel = makeLabel("Rigs: selecciona uno o dos Dummys R6…", 30, Color3.fromRGB(174, 190, 214), false)
local statusLabel = makeLabel("Conecta el servidor local y selecciona tus Dummys.", 42, Color3.fromRGB(220, 222, 228), false)
local progressLabel = makeLabel("Progreso: 0% · Frames sincronizados: 0", 22, Color3.fromRGB(174, 190, 214), false)

local logPanel = Instance.new("TextLabel")
logPanel.Name = "DebugLogs"
logPanel.Size = UDim2.new(1, 0, 0, 150)
logPanel.BackgroundColor3 = Color3.fromRGB(18, 20, 25)
logPanel.BorderSizePixel = 0
logPanel.TextColor3 = Color3.fromRGB(170, 205, 180)
logPanel.Font = Enum.Font.Code
logPanel.TextSize = 11
logPanel.TextWrapped = true
logPanel.TextXAlignment = Enum.TextXAlignment.Left
logPanel.TextYAlignment = Enum.TextYAlignment.Top
logPanel.Text = "LOGS DEL PLUGIN\nEsperando actividad..."
logPanel.Parent = root

local pluginLogs = {}
local function log(message)
    local line = os.date("%H:%M:%S") .. "  " .. tostring(message)
    print("[R6 Live Animator] " .. line)
    table.insert(pluginLogs, line)
    while #pluginLogs > 11 do
        table.remove(pluginLogs, 1)
    end
    logPanel.Text = "LOGS DEL PLUGIN\n" .. table.concat(pluginLogs, "\n")
end

local function makeButton(text, color)
    local button = Instance.new("TextButton")
    button.Size = UDim2.new(1, 0, 0, 36)
    button.BackgroundColor3 = color
    button.BorderSizePixel = 0
    button.Text = text
    button.TextColor3 = Color3.new(1, 1, 1)
    button.Font = Enum.Font.GothamBold
    button.TextSize = 13
    button.Parent = root
    return button
end

local startButton = makeButton("Empezar animación", Color3.fromRGB(42, 112, 190))
local cancelButton = makeButton("Cancelar", Color3.fromRGB(150, 62, 62))
cancelButton.Visible = false

local footer = makeLabel(
    "Clips guardados en cada Dummy > AnimSaves · Compatibles con Moon Animator",
    38,
    Color3.fromRGB(135, 143, 156),
    false
)

local sessionId = nil
local running = false
local lastSequence = 0
local currentRigs = {}
local rigsById = {}
local expectedRigCount = 0
local keyframeCount = 0
local activeTweens = {}
local liveFrameQueue = {}
local liveFrameRunner = false
local pendingFramesByTime = {}
local completionReceived = false

local function requestJson(method, url, payload)
    local options = {
        Url = url,
        Method = method,
        Headers = {
            ["Content-Type"] = "application/json",
            ["Accept"] = "application/json",
            ["Cache-Control"] = "no-cache"
        }
    }

    if payload ~= nil then
        options.Body = HttpService:JSONEncode(payload)
    end

    local ok, response = pcall(function()
        return HttpService:RequestAsync(options)
    end)

    if not ok then
        return nil, tostring(response)
    end

    if not response.Success then
        return nil, string.format("HTTP %s: %s", tostring(response.StatusCode), tostring(response.Body))
    end

    local decodedOk, decoded = pcall(function()
        return HttpService:JSONDecode(response.Body)
    end)

    if not decodedOk then
        return nil, "El servidor devolvió JSON inválido."
    end

    return decoded, nil
end

local function findRigAncestor(instance)
    local candidate = instance
    while candidate do
        if candidate:IsA("Model") and candidate:FindFirstChildOfClass("Humanoid") then
            return candidate
        end
        candidate = candidate.Parent
    end
    return nil
end

local function validateRig(rig, rigId)
    local humanoid = rig:FindFirstChildOfClass("Humanoid")
    if not humanoid then
        return nil, "El modelo " .. rig.Name .. " no tiene Humanoid."
    end
    if humanoid.RigType ~= Enum.HumanoidRigType.R6 then
        return nil, rig.Name .. " es R15. Este animador trabaja exclusivamente con R6."
    end

    local motors = {}
    for _, descendant in ipairs(rig:GetDescendants()) do
        if descendant:IsA("Motor6D") and table.find(JOINTS, descendant.Name) then
            motors[descendant.Name] = descendant
        end
    end

    for _, name in ipairs(JOINTS) do
        if not motors[name] then
            return nil, rig.Name .. " no tiene la articulación R6 " .. name
        end
    end
    for _, name in ipairs(PARTS) do
        if not rig:FindFirstChild(name, true) then
            return nil, rig.Name .. " no tiene la parte R6 " .. name
        end
    end

    local baseC0 = {}
    for _, name in ipairs(JOINTS) do
        baseC0[name] = motors[name].C0
    end

    return {
        rigId = rigId,
        model = rig,
        motors = motors,
        baseC0 = baseC0,
        sequence = nil,
        animSaves = nil
    }, nil
end

local function findSelectedRigs()
    local selected = Selection:Get()
    local candidates = {}
    local seen = {}

    for _, instance in ipairs(selected) do
        local rig = findRigAncestor(instance)
        if rig and not seen[rig] then
            seen[rig] = true
            table.insert(candidates, rig)
        end
    end

    if #candidates == 0 and #selected == 0 then
        local fallback = workspace:FindFirstChild("dummy")
        if fallback and fallback:IsA("Model") then
            table.insert(candidates, fallback)
        end
    end

    if #candidates == 0 then
        return nil, "Selecciona el Model de uno o dos Dummys R6 en Explorer o en el viewport."
    end
    if #candidates > 2 then
        return nil, "Selecciona como máximo dos Dummys R6."
    end

    local states = {}
    for index, rig in ipairs(candidates) do
        local state, rigError = validateRig(rig, "R" .. tostring(index))
        if not state then
            return nil, rigError
        end
        table.insert(states, state)
    end
    return states, nil
end

local function frameToArray(cframe)
    return { cframe:GetComponents() }
end

local function vectorToObject(vector)
    return {
        x = vector.X,
        y = vector.Y,
        z = vector.Z
    }
end

local function inspectRig(state)
    local rig = state.model
    local partData = {}
    for _, name in ipairs(PARTS) do
        local part = rig:FindFirstChild(name, true)
        partData[name] = {
            size = vectorToObject(part.Size),
            position = vectorToObject(rig:GetPivot():PointToObjectSpace(part.Position)),
            cframe = frameToArray(rig:GetPivot():ToObjectSpace(part.CFrame))
        }
    end

    local jointData = {}
    for _, name in ipairs(JOINTS) do
        local motor = state.motors[name]
        jointData[name] = {
            part0 = motor.Part0 and motor.Part0.Name or "",
            part1 = motor.Part1 and motor.Part1.Name or "",
            c0 = frameToArray(motor.C0),
            c1 = frameToArray(motor.C1),
            transform = frameToArray(motor.Transform)
        }
    end

    return {
        rigId = state.rigId,
        rigName = rig.Name,
        rigType = "R6",
        parts = partData,
        joints = jointData
    }
end

local function toCFrame(pose)
    return CFrame.new(
        tonumber(pose.x) or 0,
        tonumber(pose.y) or 0,
        tonumber(pose.z) or 0
    ) * CFrame.Angles(
        math.rad(tonumber(pose.rx) or 0),
        math.rad(tonumber(pose.ry) or 0),
        math.rad(tonumber(pose.rz) or 0)
    )
end

local function moveLegacySequences(sourceFolder, targetFolder)
    if not sourceFolder or not sourceFolder:IsA("Folder") or sourceFolder == targetFolder then
        return
    end

    local moved = 0
    for _, child in ipairs(sourceFolder:GetChildren()) do
        if child:IsA("KeyframeSequence") then
            local baseName = child.Name
            local newName = baseName
            local suffix = 1
            while targetFolder:FindFirstChild(newName) do
                newName = baseName .. "_Old_" .. tostring(suffix)
                suffix += 1
            end
            child.Name = newName
            child.Parent = targetFolder
            moved += 1
        end
    end
    if moved > 0 then
        log(string.format("Se conservaron %d clips anteriores de %s.", moved, targetFolder.Parent.Name))
    end
end

local function getMoonAnimSavesFolder(rig)
    local existing = rig:FindFirstChild("AnimSaves")
    local legacyFolder = nil

    if existing and existing:IsA("ObjectValue") then
        legacyFolder = existing.Value
        existing.Name = "AnimSaves_LegacyReference"
        existing = nil
        log("Se conservó la referencia AnimSaves anterior en " .. rig.Name .. ".")
    elseif existing and not existing:IsA("Folder") then
        error(rig.Name .. ".AnimSaves existe, pero no es Folder.")
    end

    if not existing then
        existing = Instance.new("Folder")
        existing.Name = "AnimSaves"
        existing.Parent = rig
    end

    moveLegacySequences(legacyFolder, existing)
    return existing
end

local function makePose(parent, name, cframe)
    local pose = Instance.new("Pose")
    pose.Name = name
    pose.CFrame = cframe
    pose.EasingStyle = Enum.PoseEasingStyle.Cubic
    pose.EasingDirection = Enum.PoseEasingDirection.Out
    pose.Parent = parent
    return pose
end

local function createSequence(state, name)
    local folder = getMoonAnimSavesFolder(state.model)
    state.animSaves = folder

    local baseName = (name or "R6_AI_Animation"):gsub("[^%w_%-]", "_")
    local safeRigName = state.model.Name:gsub("[^%w_%-]", "_")
    local sequenceName = baseName .. "_" .. safeRigName
    local candidateName = sequenceName
    local suffix = 1
    while folder:FindFirstChild(candidateName) do
        candidateName = sequenceName .. "_" .. tostring(suffix)
        suffix += 1
    end

    local sequence = Instance.new("KeyframeSequence")
    sequence.Name = candidateName
    sequence.Loop = false
    sequence.Priority = Enum.AnimationPriority.Action
    sequence.Parent = folder
    state.sequence = sequence
    log("Clip creado: " .. state.model.Name .. ".AnimSaves." .. sequence.Name)
    return sequence
end

local function addSequenceKeyframe(state, data, frameIndex)
    if not state.sequence then
        createSequence(state, "R6_AI_Animation")
    end

    for _, old in ipairs(state.sequence:GetChildren()) do
        if old:IsA("Keyframe") and math.abs(old.Time - data.time) < 0.0005 then
            old:Destroy()
        end
    end

    local keyframe = Instance.new("Keyframe")
    keyframe.Name = string.format("Keyframe_%03d", frameIndex)
    keyframe.Time = data.time
    keyframe.Parent = state.sequence

    local rootPose = makePose(keyframe, "HumanoidRootPart", CFrame.identity)
    local torsoPose = makePose(rootPose, "Torso", toCFrame(data.joints["RootJoint"]))

    makePose(torsoPose, "Head", toCFrame(data.joints["Neck"]))
    makePose(torsoPose, "Left Arm", toCFrame(data.joints["Left Shoulder"]))
    makePose(torsoPose, "Right Arm", toCFrame(data.joints["Right Shoulder"]))
    makePose(torsoPose, "Left Leg", toCFrame(data.joints["Left Hip"]))
    makePose(torsoPose, "Right Leg", toCFrame(data.joints["Right Hip"]))
end

local function cancelActiveTweens()
    for _, tween in pairs(activeTweens) do
        pcall(function()
            tween:Cancel()
        end)
    end
    activeTweens = {}
end

local function applySynchronizedFrameGroup(group)
    local tweens = {}
    local movedJoints = 0

    for rigId, frame in pairs(group.rigs) do
        local state = rigsById[rigId]
        if state and state.model and state.model.Parent then
            for _, jointName in ipairs(JOINTS) do
                local motor = state.motors[jointName]
                local pose = frame.joints[jointName]
                if motor and pose then
                    local baseC0 = state.baseC0[jointName] or motor.C0
                    local target = baseC0 * toCFrame(pose)
                    if motor.C0 ~= target then
                        local tweenInfo = TweenInfo.new(
                            FRAME_TRANSITION_SECONDS,
                            Enum.EasingStyle.Sine,
                            Enum.EasingDirection.InOut
                        )
                        local created, tween = pcall(function()
                            return TweenService:Create(motor, tweenInfo, { C0 = target })
                        end)
                        if created and tween then
                            activeTweens[motor] = tween
                            table.insert(tweens, {
                                tween = tween,
                                motor = motor,
                                target = target,
                                rigId = rigId,
                                jointName = jointName
                            })
                        else
                            motor.C0 = target
                            movedJoints += 1
                        end
                    end
                end
            end
        end
    end

    -- Start every joint tween on every selected rig before waiting for any of them.
    for _, entry in ipairs(tweens) do
        local played = pcall(function()
            entry.tween:Play()
        end)
        if not played then
            entry.motor.C0 = entry.target
            movedJoints += 1
        else
            movedJoints += 1
        end
    end

    for _, entry in ipairs(tweens) do
        pcall(function()
            entry.tween.Completed:Wait()
        end)
        if activeTweens[entry.motor] == entry.tween then
            activeTweens[entry.motor] = nil
        end
    end

    log(string.format(
        "Frame sincronizado t=%.3fs · %d Dummy(s) · %d articulaciones",
        tonumber(group.time) or 0,
        expectedRigCount,
        movedJoints
    ))
    statusLabel.Text = string.format(
        "Moviendo %d Dummys al mismo tiempo · t=%.2fs",
        expectedRigCount,
        tonumber(group.time) or 0
    )
end

local function updateCompletion()
    if completionReceived and not liveFrameRunner and #liveFrameQueue == 0 then
        statusLabel.Text = string.format(
            "Animación completa. %d clip(s) guardados en AnimSaves.",
            expectedRigCount
        )
        progressLabel.Text = string.format(
            "Progreso: 100%% · Frames sincronizados: %d",
            keyframeCount
        )
        running = false
        sessionId = nil
        cancelButton.Visible = false
        startButton.Active = true
        startButton.AutoButtonColor = true
    end
end

local function queueSynchronizedFrame(group)
    table.insert(liveFrameQueue, group)
    if liveFrameRunner then
        return
    end

    liveFrameRunner = true
    task.spawn(function()
        while running and #liveFrameQueue > 0 do
            local nextGroup = table.remove(liveFrameQueue, 1)
            local ok, applyError = pcall(applySynchronizedFrameGroup, nextGroup)
            if not ok then
                log("Error aplicando frame sincronizado: " .. tostring(applyError))
            end
        end

        liveFrameRunner = false
        if not running then
            startButton.Active = true
            startButton.AutoButtonColor = true
        end
        updateCompletion()
    end)
end

local function queueFrameEvent(event)
    local state = rigsById[event.rigId]
    if not state then
        log("Frame recibido para rig desconocido: " .. tostring(event.rigId))
        return
    end

    local timeKey = string.format("%.4f", tonumber(event.time) or 0)
    local bucket = pendingFramesByTime[timeKey]
    if not bucket then
        bucket = {
            time = tonumber(event.time) or 0,
            rigs = {}
        }
        pendingFramesByTime[timeKey] = bucket
    end

    if bucket.rigs[event.rigId] then
        log("Frame duplicado ignorado para " .. state.model.Name .. " en t=" .. timeKey)
        return
    end

    bucket.rigs[event.rigId] = event
    local receivedCount = 0
    for _ in pairs(bucket.rigs) do
        receivedCount += 1
    end

    log(string.format(
        "Frame recibido de %s (%d/%d rigs) en t=%.3fs",
        state.model.Name,
        receivedCount,
        expectedRigCount,
        bucket.time
    ))

    if receivedCount == expectedRigCount then
        local frameIndex = keyframeCount + 1
        for _, rigState in ipairs(currentRigs) do
            local rigFrame = bucket.rigs[rigState.rigId]
            if not rigFrame then
                log("No llegó el frame sincronizado de " .. rigState.model.Name)
                return
            end
            addSequenceKeyframe(rigState, rigFrame, frameIndex)
        end

        keyframeCount += 1
        pendingFramesByTime[timeKey] = nil
        queueSynchronizedFrameGroup(bucket)
        progressLabel.Text = string.format(
            "Progreso: %d%% · Frames sincronizados: %d",
            math.floor(tonumber(event.progress) or 0),
            keyframeCount
        )
    end
end

local function restoreRigBaseC0()
    for _, state in ipairs(currentRigs) do
        for _, jointName in ipairs(JOINTS) do
            local motor = state.motors[jointName]
            local baseC0 = state.baseC0[jointName]
            if motor and baseC0 then
                pcall(function()
                    motor.C0 = baseC0
                end)
            end
        end
    end
end

local function resetSessionUi(restorePose)
    running = false
    sessionId = nil
    liveFrameQueue = {}
    pendingFramesByTime = {}
    completionReceived = false
    cancelActiveTweens()
    if restorePose then
        restoreRigBaseC0()
    end
    startButton.Active = not liveFrameRunner
    startButton.AutoButtonColor = not liveFrameRunner
    cancelButton.Visible = false
end

local function handleEvent(event)
    local eventType = event.type

    if eventType == "status" then
        log("Estado: " .. tostring(event.status or event.message or "trabajando"))
        statusLabel.Text = event.message or ("Estado: " .. tostring(event.status or "trabajando"))
        if event.progress then
            progressLabel.Text = string.format(
                "Progreso: %d%% · Frames sincronizados: %d",
                event.progress,
                keyframeCount
            )
        end
        return
    end

    if eventType == "meta" then
        log(string.format(
            'La IA inició "%s" para %d rig(s), duración %.2fs.',
            tostring(event.name or "animación"),
            expectedRigCount,
            tonumber(event.duration) or 0
        ))
        for _, state in ipairs(currentRigs) do
            createSequence(state, event.name)
        end
        statusLabel.Text = "La IA está construyendo una sola línea de tiempo para los Dummys…"
        return
    end

    if eventType == "joint" then
        local state = rigsById[event.rigId]
        local rigName = state and state.model.Name or tostring(event.rigId)
        local partName = JOINT_TO_PART[event.joint] or tostring(event.joint)
        log(string.format(
            "IA definió %s para %s en t=%.2fs",
            partName,
            rigName,
            tonumber(event.time) or 0
        ))
        return
    end

    if eventType == "frame" then
        queueFrameEvent(event)
        return
    end

    if eventType == "keyframe" and expectedRigCount == 1 then
        local state = currentRigs[1]
        if state then
            keyframeCount += 1
            addSequenceKeyframe(state, event, keyframeCount)
            queueSynchronizedFrameGroup({
                time = event.time,
                rigs = { [state.rigId] = event }
            })
        end
        return
    end

    if eventType == "complete" then
        log("La IA terminó todos los keyframes de la línea de tiempo.")
        completionReceived = true
        updateCompletion()
        return
    end

    if eventType == "error" then
        log("ERROR DEL SERVIDOR: " .. tostring(event.error or "sin detalle"))
        statusLabel.Text = "Error: " .. tostring(event.error or "No se pudo completar la animación.")
        resetSessionUi(true)
        return
    end

    if eventType == "cancelled" then
        log("Animación cancelada por el servidor.")
        statusLabel.Text = "Animación cancelada."
        resetSessionUi(true)
    end
end

local function pollSession()
    while running and sessionId do
        local url = string.format(
            "%s/api/animations/%s/events?after=%d",
            BASE_URL,
            sessionId,
            lastSequence
        )

        local data, err = requestJson("GET", url)
        if not data then
            log("ERROR consultando eventos: " .. tostring(err))
            statusLabel.Text = "Conexión perdida: " .. tostring(err)
            resetSessionUi(true)
            break
        end

        if #(data.events or {}) > 0 then
            log(string.format(
                "Polling: %d evento(s), estado=%s, progreso=%s%%",
                #data.events,
                tostring(data.status),
                tostring(data.progress or "?")
            ))
        end

        for _, event in ipairs(data.events or {}) do
            lastSequence = math.max(lastSequence, tonumber(event.sequence) or lastSequence)
            handleEvent(event)
        end

        if data.status == "error" or data.status == "cancelled" then
            if running then
                resetSessionUi(true)
            end
            break
        elseif data.status == "complete" then
            completionReceived = true
            updateCompletion()
            break
        end

        task.wait(POLL_INTERVAL)
    end
end

local function beginAnimation()
    if running then
        return
    end

    local description = prompt.Text:gsub("^%s+", ""):gsub("%s+$", "")
    if #description < 5 then
        statusLabel.Text = "Escribe una descripción de la animación."
        return
    end

    local rigStates, rigError = findSelectedRigs()
    if not rigStates then
        statusLabel.Text = rigError
        return
    end

    log("Comprobando servidor local...")
    local health, healthError = requestJson("GET", BASE_URL .. "/health")
    if not health then
        log("ERROR servidor local: " .. tostring(healthError))
        statusLabel.Text = "No se encuentra el servidor local. Ejecuta npm start en la carpeta ia. " .. tostring(healthError)
        return
    end
    if not health.apiKeyConfigured then
        statusLabel.Text = "Falta GEMINI_API_KEY en ia/.env."
        return
    end

    currentRigs = rigStates
    rigsById = {}
    expectedRigCount = #currentRigs
    local rigSnapshots = {}
    local rigNames = {}

    for _, state in ipairs(currentRigs) do
        rigsById[state.rigId] = state
        table.insert(rigSnapshots, inspectRig(state))
        table.insert(rigNames, state.model.Name)
        log("Dummy R6 validado: " .. state.model:GetFullName() .. " (" .. state.rigId .. ").")
    end

    selectedRigLabel.Text = "Rigs: " .. table.concat(rigNames, " + ") .. " (R6)"
    keyframeCount = 0
    lastSequence = 0
    liveFrameQueue = {}
    liveFrameRunner = false
    pendingFramesByTime = {}
    completionReceived = false
    cancelActiveTweens()

    local payload = {
        description = description,
        rigs = rigSnapshots
    }

    log("Enviando una sola solicitud para animar " .. tostring(expectedRigCount) .. " Dummy(s) sincronizados...")
    local result, err = requestJson("POST", BASE_URL .. "/api/animations", payload)
    if not result or not result.sessionId then
        log("ERROR iniciando sesión: " .. tostring(err or (result and result.error)))
        statusLabel.Text = "No se pudo iniciar: " .. tostring(err or (result and result.error))
        return
    end

    sessionId = result.sessionId
    log("Sesión sincronizada iniciada: " .. tostring(sessionId))
    running = true
    startButton.Active = false
    startButton.AutoButtonColor = false
    cancelButton.Visible = true
    statusLabel.Text = "La IA está planificando y moviendo los Dummys en paralelo…"
    progressLabel.Text = "Progreso: 0% · Frames sincronizados: 0"

    task.spawn(pollSession)
end

local function cancelAnimation()
    if not sessionId then
        resetSessionUi(true)
        return
    end

    local id = sessionId
    requestJson("POST", BASE_URL .. "/api/animations/" .. id .. "/cancel", {})
    statusLabel.Text = "Cancelando…"
    resetSessionUi(true)
end

startButton.Activated:Connect(beginAnimation)
cancelButton.Activated:Connect(cancelAnimation)

openButton.Click:Connect(function()
    widget.Enabled = not widget.Enabled
end)

local function updateSelectionLabel()
    local rigStates, err = findSelectedRigs()
    if not rigStates then
        selectedRigLabel.Text = "Rigs: " .. tostring(err)
        return
    end
    local names = {}
    for _, state in ipairs(rigStates) do
        table.insert(names, state.model.Name)
    end
    selectedRigLabel.Text = "Rigs: " .. table.concat(names, " + ") .. " (R6)"
end

widget:GetPropertyChangedSignal("Enabled"):Connect(function()
    if widget.Enabled then
        updateSelectionLabel()
    end
end)

Selection.SelectionChanged:Connect(function()
    if widget.Enabled and not running then
        updateSelectionLabel()
    end
end)

log("Plugin cargado. Selecciona uno o dos Dummys R6 para crear animaciones sincronizadas.")
