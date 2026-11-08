local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local TweenService = game:GetService("TweenService")
local ServerStorage = game:GetService("ServerStorage")

local BASE_URL = "http://127.0.0.1:3000"
local POLL_INTERVAL = 0.30

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
    "Animar un dummy R6 en directo con IA",
    ""
)
openButton.ClickableWhenViewportHidden = true

local widgetInfo = DockWidgetPluginGuiInfo.new(
    Enum.InitialDockState.Right,
    true,
    false,
    360,
    520,
    320,
    420
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
local subtitle = makeLabel("La IA mueve cada parte en el viewport mientras crea los keyframes.", 34)

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
prompt.PlaceholderText = "Describe la animación. Ejemplo: el personaje levanta lentamente el brazo derecho, saluda tres veces y después lo baja."
prompt.Text = ""
prompt.Parent = root

local promptPadding = Instance.new("UIPadding")
promptPadding.PaddingTop = UDim.new(0, 8)
promptPadding.PaddingBottom = UDim.new(0, 8)
promptPadding.PaddingLeft = UDim.new(0, 8)
promptPadding.PaddingRight = UDim.new(0, 8)
promptPadding.Parent = prompt

local selectedRigLabel = makeLabel("Rig: buscando dummy R6…", 22, Color3.fromRGB(174, 190, 214), false)
local statusLabel = makeLabel("Conecta el servidor local y selecciona un dummy R6.", 42, Color3.fromRGB(220, 222, 228), false)
local progressLabel = makeLabel("Progreso: 0% · Keyframes: 0", 22, Color3.fromRGB(174, 190, 214), false)

local logPanel = Instance.new("TextLabel")
logPanel.Name = "DebugLogs"
logPanel.Size = UDim2.new(1, 0, 0, 116)
logPanel.BackgroundColor3 = Color3.fromRGB(18, 20, 25)
logPanel.BorderSizePixel = 0
logPanel.TextColor3 = Color3.fromRGB(170, 205, 180)
logPanel.Font = Enum.Font.Code
logPanel.TextSize = 11
logPanel.TextWrapped = true
logPanel.TextXAlignment = Enum.TextXAlignment.Left
logPanel.TextYAlignment = Enum.TextYAlignment.Top
logPanel.Text = "LOGS DEL PLUGIN\\nEsperando actividad..."
logPanel.Parent = root

local pluginLogs = {}
local function log(message)
    local line = os.date("%H:%M:%S") .. "  " .. tostring(message)
    print("[R6 Live Animator] " .. line)
    table.insert(pluginLogs, line)
    while #pluginLogs > 9 do
        table.remove(pluginLogs, 1)
    end
    logPanel.Text = "LOGS DEL PLUGIN\\n" .. table.concat(pluginLogs, "\\n")
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
local approveButton = makeButton("Aprobar al 80% y terminar", Color3.fromRGB(34, 139, 91))
approveButton.Visible = false
local cancelButton = makeButton("Cancelar", Color3.fromRGB(150, 62, 62))
cancelButton.Visible = false

local footer = makeLabel("Vista previa directa en el viewport · Clips vinculados al rig mediante AnimSaves", 38, Color3.fromRGB(135, 143, 156), false)

local sessionId = nil
local running = false
local awaitingApproval = false
local lastSequence = 0
local currentRig = nil
local currentMotors = {}
local currentBaseC0 = {}
local lastFrameTime = nil
local currentSequence = nil
local keyframeCount = 0
local activeTweens = {}
local liveFrameQueue = {}
local liveFrameRunner = false
local checkpointReceived = false
local completionReceived = false
local animationFolder = nil

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

local function findSelectedRig()
    local selected = Selection:Get()
    local candidate = selected[1]

    while candidate and not candidate:IsA("Model") do
        candidate = candidate.Parent
    end

    if not candidate then
        candidate = workspace:FindFirstChild("dummy")
    end

    if not candidate or not candidate:IsA("Model") then
        return nil, "Selecciona el Model del dummy R6 en Explorer o en el viewport."
    end

    local humanoid = candidate:FindFirstChildOfClass("Humanoid")
    if not humanoid then
        return nil, "El Model seleccionado no tiene Humanoid."
    end

    if humanoid.RigType ~= Enum.HumanoidRigType.R6 then
        return nil, "El personaje seleccionado es R15. Este animador trabaja exclusivamente con R6."
    end

    local motors = {}
    for _, descendant in ipairs(candidate:GetDescendants()) do
        if descendant:IsA("Motor6D") and table.find(JOINTS, descendant.Name) then
            motors[descendant.Name] = descendant
        end
    end

    for _, name in ipairs(JOINTS) do
        if not motors[name] then
            return nil, "Falta la articulación R6: " .. name
        end
    end

    for _, name in ipairs(PARTS) do
        if not candidate:FindFirstChild(name, true) then
            return nil, "Falta la parte R6: " .. name
        end
    end

    return candidate, nil, motors
end

local function frameToArray(cframe)
    local values = { cframe:GetComponents() }
    return values
end

local function vectorToObject(vector)
    return {
        x = vector.X,
        y = vector.Y,
        z = vector.Z
    }
end

local function inspectRig(rig, motors)
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
        local motor = motors[name]
        jointData[name] = {
            part0 = motor.Part0 and motor.Part0.Name or "",
            part1 = motor.Part1 and motor.Part1.Name or "",
            c0 = frameToArray(motor.C0),
            c1 = frameToArray(motor.C1),
            transform = frameToArray(motor.Transform)
        }
    end

    return {
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

local function getAnimationFolder()
    if not currentRig then
        error("No hay un rig seleccionado para guardar la animación.")
    end

    -- El Animation Editor de Studio espera este contenedor exacto:
    -- ServerStorage.RBX_ANIMSAVES.<nombre del rig>
    local rootFolder = ServerStorage:FindFirstChild("RBX_ANIMSAVES")
    if rootFolder and not rootFolder:IsA("Folder") then
        error("ServerStorage.RBX_ANIMSAVES existe, pero no es una Folder.")
    end

    if not rootFolder then
        rootFolder = Instance.new("Folder")
        rootFolder.Name = "RBX_ANIMSAVES"
        rootFolder.Parent = ServerStorage
    end

    local rigFolder = rootFolder:FindFirstChild(currentRig.Name)
    if rigFolder and not rigFolder:IsA("Folder") then
        error("RBX_ANIMSAVES ya contiene un objeto que no es Folder llamado " .. currentRig.Name)
    end

    if not rigFolder then
        rigFolder = Instance.new("Folder")
        rigFolder.Name = currentRig.Name
        rigFolder.Parent = rootFolder
    end

    animationFolder = rigFolder
    log("Carpeta de clips: ServerStorage.RBX_ANIMSAVES." .. currentRig.Name)
    return animationFolder
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

local function linkAnimationFolderToRig(folder)
    if not currentRig or not currentRig.Parent then
        return
    end

    local reference = currentRig:FindFirstChild("AnimSaves")
    if reference and not reference:IsA("ObjectValue") then
        -- Preserve any legacy folder instead of deleting the user's saved clips.
        local suffix = 1
        local legacyName = "AnimSaves_Legacy"
        while currentRig:FindFirstChild(legacyName) do
            suffix += 1
            legacyName = "AnimSaves_Legacy_" .. tostring(suffix)
        end
        reference.Name = legacyName
        log("Se conservó la carpeta AnimSaves anterior como " .. legacyName)
        reference = nil
    end

    if not reference then
        reference = Instance.new("ObjectValue")
        reference.Name = "AnimSaves"
        reference.Parent = currentRig
    end

    reference.Value = folder
    log("AnimSaves apunta a ServerStorage.RBX_ANIMSAVES." .. currentRig.Name)
end

local function createSequence(name)
    local folder = getAnimationFolder()
    linkAnimationFolderToRig(folder)
    local sequence = Instance.new("KeyframeSequence")
    sequence.Name = (name or "R6_AI_Animation"):gsub("[^%w_%-]", "_")
    sequence.Loop = false
    sequence.Priority = Enum.AnimationPriority.Action
    sequence.Parent = folder
    currentSequence = sequence
    return sequence
end

local function addSequenceKeyframe(data)
    if not currentSequence then
        createSequence("R6_AI_Animation")
    end

    for _, old in ipairs(currentSequence:GetChildren()) do
        if old:IsA("Keyframe") and math.abs(old.Time - data.time) < 0.0005 then
            old:Destroy()
        end
    end

    local keyframe = Instance.new("Keyframe")
    keyframe.Name = string.format("Keyframe_%03d", keyframeCount + 1)
    keyframe.Time = data.time
    keyframe.Parent = currentSequence

    local rootPose = makePose(keyframe, "HumanoidRootPart", CFrame.identity)
    local torsoPose = makePose(rootPose, "Torso", toCFrame(data.joints["RootJoint"]))

    makePose(torsoPose, "Head", toCFrame(data.joints["Neck"]))
    makePose(torsoPose, "Left Arm", toCFrame(data.joints["Left Shoulder"]))
    makePose(torsoPose, "Right Arm", toCFrame(data.joints["Right Shoulder"]))
    makePose(torsoPose, "Left Leg", toCFrame(data.joints["Left Hip"]))
    makePose(torsoPose, "Right Leg", toCFrame(data.joints["Right Hip"]))
end

local JOINT_STEP_SECONDS = 0.14
local resetSessionUi

local function applyLiveJointAction(action)
    if not currentRig or not currentRig.Parent then
        return
    end

    local jointName = action.joint
    local partName = JOINT_TO_PART[jointName] or jointName
    local motor = currentMotors[jointName]
    if not motor then
        log("No se encontró Motor6D para " .. tostring(jointName))
        return
    end

    local baseC0 = currentBaseC0[jointName] or motor.C0
    local target = baseC0 * toCFrame(action.pose)
    local changed = motor.C0 ~= target

    if changed then
        statusLabel.Text = "IA moviendo: " .. partName .. " (" .. jointName .. ")…"
        local created, tween = pcall(function()
            return TweenService:Create(
                motor,
                TweenInfo.new(JOINT_STEP_SECONDS, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut),
                { C0 = target }
            )
        end)

        if created and tween then
            activeTweens[jointName] = tween
            local played = pcall(function()
                tween:Play()
                tween.Completed:Wait()
            end)
            if activeTweens[jointName] == tween then
                activeTweens[jointName] = nil
            end
            if not played then
                pcall(function() tween:Cancel() end)
                motor.C0 = target
                log("Tween no disponible; pose C0 aplicada directamente a " .. partName)
            end
        else
            motor.C0 = target
            log("Tween no disponible; pose C0 aplicada directamente a " .. partName)
        end

        log(string.format("IA movió %s en t=%.2fs", partName, tonumber(action.time) or 0))
    else
        statusLabel.Text = "IA mantiene: " .. partName .. " (" .. jointName .. ")"
        log(string.format("IA mantiene %s sin cambio en t=%.2fs", partName, tonumber(action.time) or 0))
    end
end

local function updateCheckpointAndCompletion()
    if not liveFrameRunner and #liveFrameQueue == 0 then
        if completionReceived then
            statusLabel.Text = "Animación terminada. KeyframeSequence editable en ServerStorage/R6LiveAnimations."
            progressLabel.Text = string.format("Progreso: 100%% · Keyframes: %d", keyframeCount)
            resetSessionUi()
        elseif checkpointReceived then
            awaitingApproval = true
            approveButton.Visible = true
            statusLabel.Text = "80% listo. La vista previa terminó; revisa el dummy y aprueba para continuar."
            progressLabel.Text = string.format("Progreso: 80%% · Keyframes: %d", keyframeCount)
        end
    end
end

local function queueLiveJointAction(action)
    table.insert(liveFrameQueue, action)
    if liveFrameRunner then return end

    liveFrameRunner = true
    task.spawn(function()
        while running and #liveFrameQueue > 0 do
            local nextAction = table.remove(liveFrameQueue, 1)
            local ok, actionError = pcall(applyLiveJointAction, nextAction)
            if not ok then
                log("ERROR aplicando movimiento " .. tostring(nextAction.joint) .. ": " .. tostring(actionError))
            end
        end

        liveFrameRunner = false
        if not running then
            startButton.Active = true
            startButton.AutoButtonColor = true
        end
        updateCheckpointAndCompletion()
    end)
end

local function queueLiveKeyframe(data)
    for _, jointName in ipairs(JOINTS) do
        queueLiveJointAction({
            type = "joint",
            time = data.time,
            joint = jointName,
            pose = data.joints[jointName]
        })
    end
end

local function cancelActiveTweens()
    for _, tween in pairs(activeTweens) do
        pcall(function()
            tween:Cancel()
        end)
    end
    activeTweens = {}
end

local function restoreRigBaseC0()
    for _, jointName in ipairs(JOINTS) do
        local motor = currentMotors[jointName]
        local baseC0 = currentBaseC0[jointName]
        if motor and baseC0 then
            pcall(function()
                motor.C0 = baseC0
            end)
        end
    end
    currentBaseC0 = {}
end

resetSessionUi = function()
    running = false
    awaitingApproval = false
    sessionId = nil
    liveFrameQueue = {}
    checkpointReceived = false
    completionReceived = false
    cancelActiveTweens()
    restoreRigBaseC0()
    startButton.Active = not liveFrameRunner
    startButton.AutoButtonColor = not liveFrameRunner
    approveButton.Visible = false
    cancelButton.Visible = false
end

local function handleEvent(event)
    local eventType = event.type

    if eventType == "status" then
        log("Estado del servidor: " .. tostring(event.status or event.message or "trabajando"))
        statusLabel.Text = event.message or ("Estado: " .. tostring(event.status or "trabajando"))
        if event.progress then
            progressLabel.Text = string.format("Progreso: %d%% · Keyframes: %d", event.progress, keyframeCount)
        end
        return
    end

    if eventType == "meta" then
        log("Metadatos recibidos: " .. tostring(event.name or "animación"))
        if not currentSequence then
            createSequence(event.name)
        end
        statusLabel.Text = "Generando: " .. tostring(event.name)
        return
    end

    if eventType == "joint" then
        local partName = JOINT_TO_PART[event.joint] or tostring(event.joint)
        log("Acción de IA recibida: " .. partName .. " (" .. tostring(event.joint) .. ")")
        queueLiveJointAction(event)
        progressLabel.Text = string.format(
            "Progreso: %d%% · Keyframes: %d",
            math.floor(tonumber(event.progress) or 0),
            keyframeCount
        )
        return
    end

    if eventType == "frame" then
        addSequenceKeyframe(event)
        keyframeCount += 1
        log(string.format("Keyframe #%d guardado en la secuencia (t=%.2fs)", keyframeCount, tonumber(event.time) or 0))
        progressLabel.Text = string.format(
            "Progreso: %d%% · Keyframes: %d",
            math.floor(tonumber(event.progress) or 0),
            keyframeCount
        )
        statusLabel.Text = "La IA sigue creando movimientos sobre el dummy…"
        return
    end

    if eventType == "keyframe" then
        -- Compatibilidad con versiones anteriores del servidor.
        log(string.format("Keyframe completo recibido #%d en t=%.2fs", keyframeCount + 1, tonumber(event.time) or 0))
        addSequenceKeyframe(event)
        keyframeCount += 1
        queueLiveKeyframe(event)
        progressLabel.Text = string.format("Progreso: %d%% · Keyframes: %d", math.floor(tonumber(event.progress) or 0), keyframeCount)
        return
    end

    if eventType == "checkpoint" then
        log("Checkpoint del 80% recibido; esperando aprobación.")
        checkpointReceived = true
        awaitingApproval = false
        approveButton.Visible = false
        statusLabel.Text = "80% generado. Reproduciendo la vista previa antes de pedir tu aprobación…"
        updateCheckpointAndCompletion()
        return
    end

    if eventType == "complete" then
        log("Evento complete recibido.")
        completionReceived = true
        statusLabel.Text = "La IA terminó de generar. Reproduciendo los últimos keyframes…"
        updateCheckpointAndCompletion()
        return
    end

    if eventType == "error" then
        log("ERROR DEL SERVIDOR: " .. tostring(event.error or "sin detalle"))
        statusLabel.Text = "Error: " .. tostring(event.error or "No se pudo completar la animación.")
        resetSessionUi()
        return
    end

    if eventType == "cancelled" then
        log("Animación cancelada por el servidor.")
        statusLabel.Text = "Animación cancelada."
        resetSessionUi()
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
            resetSessionUi()
            break
        end

        if #(data.events or {}) > 0 then
            log(string.format("Polling: %d evento(s), estado=%s, progreso=%s%%", #data.events, tostring(data.status), tostring(data.progress or "?")))
        end

        for _, event in ipairs(data.events or {}) do
            lastSequence = math.max(lastSequence, tonumber(event.sequence) or lastSequence)
            handleEvent(event)
        end

        if data.status == "error" or data.status == "cancelled" then
            if running then
                resetSessionUi()
            end
            break
        elseif data.status == "complete" then
            completionReceived = true
            updateCheckpointAndCompletion()
            break
        end

        task.wait(POLL_INTERVAL)
    end
end

local function beginAnimation()
    if running then return end

    local description = prompt.Text:gsub("^%s+", ""):gsub("%s+$", "")
    if #description < 5 then
        statusLabel.Text = "Escribe una descripción de la animación."
        return
    end

    local rig, rigError, motors = findSelectedRig()
    if not rig then
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

    currentRig = rig
    currentMotors = motors
    currentBaseC0 = {}
    for _, jointName in ipairs(JOINTS) do
        currentBaseC0[jointName] = motors[jointName].C0
    end
    log("Dummy R6 validado: " .. rig:GetFullName() .. " (6 articulaciones).")
    selectedRigLabel.Text = "Rig: " .. rig.Name .. " (R6)"
    lastFrameTime = nil
    currentSequence = nil
    keyframeCount = 0
    lastSequence = 0
    liveFrameQueue = {}
    liveFrameRunner = false
    checkpointReceived = false
    completionReceived = false
    cancelActiveTweens()

    local payload = {
        description = description,
        rig = inspectRig(rig, motors)
    }

    log("Enviando solicitud de animación al servidor...")
    local result, err = requestJson("POST", BASE_URL .. "/api/animations", payload)
    if not result or not result.sessionId then
        log("ERROR iniciando sesión: " .. tostring(err or (result and result.error)))
        statusLabel.Text = "No se pudo iniciar: " .. tostring(err or result.error)
        return
    end

    sessionId = result.sessionId
    log("Sesión iniciada: " .. tostring(sessionId))
    running = true
    awaitingApproval = false
    startButton.Active = false
    startButton.AutoButtonColor = false
    approveButton.Visible = false
    cancelButton.Visible = true
    statusLabel.Text = "Petición enviada. Conectando con Antigravity…"
    progressLabel.Text = "Progreso: 0% · Keyframes: 0"

    task.spawn(pollSession)
end

local function approveAnimation()
    if not running or not awaitingApproval or not sessionId then return end

    approveButton.Visible = false
    log("Aprobación del usuario enviada.")
    statusLabel.Text = "Aprobado. Antigravity está terminando el último 20%…"

    local result, err = requestJson(
        "POST",
        BASE_URL .. "/api/animations/" .. sessionId .. "/approve",
        { approved = true }
    )

    if not result then
        statusLabel.Text = "No se pudo enviar la aprobación: " .. tostring(err)
        approveButton.Visible = true
        return
    end

    awaitingApproval = false
end

local function cancelAnimation()
    if not sessionId then
        resetSessionUi()
        return
    end

    local id = sessionId
    requestJson("POST", BASE_URL .. "/api/animations/" .. id .. "/cancel", {})
    statusLabel.Text = "Cancelando…"
    resetSessionUi()
end

startButton.Activated:Connect(beginAnimation)
approveButton.Activated:Connect(approveAnimation)
cancelButton.Activated:Connect(cancelAnimation)

openButton.Click:Connect(function()
    widget.Enabled = not widget.Enabled
end)

widget:GetPropertyChangedSignal("Enabled"):Connect(function()
    if widget.Enabled then
        local rig, err = findSelectedRig()
        selectedRigLabel.Text = rig and ("Rig: " .. rig.Name .. " (R6)") or ("Rig: " .. tostring(err))
    end
end)

log("Plugin cargado. Selecciona un dummy R6 y describe la animación.")
