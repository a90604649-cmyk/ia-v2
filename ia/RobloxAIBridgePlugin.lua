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
local subtitle = makeLabel("La IA moverá el dummy mientras construye los keyframes.", 34)

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

local footer = makeLabel("Vista previa en el viewport · Secuencia editable en ServerStorage/R6LiveAnimations", 38, Color3.fromRGB(135, 143, 156), false)

local sessionId = nil
local running = false
local awaitingApproval = false
local lastSequence = 0
local currentRig = nil
local currentMotors = {}
local lastFrameTime = nil
local currentSequence = nil
local keyframeCount = 0
local activeTweens = {}
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
    if animationFolder and animationFolder.Parent then
        return animationFolder
    end

    animationFolder = ServerStorage:FindFirstChild("R6LiveAnimations")
    if not animationFolder then
        animationFolder = Instance.new("Folder")
        animationFolder.Name = "R6LiveAnimations"
        animationFolder.Parent = ServerStorage
    end
    return animationFolder
end

local function makePose(parent, name, cframe)
    local pose = Instance.new("Pose")
    pose.Name = name
    pose.CFrame = cframe
    pose.Parent = parent
    return pose
end

local function createSequence(name)
    local folder = getAnimationFolder()
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

local function applyLiveKeyframe(data)
    if not currentRig or not currentRig.Parent then
        return
    end

    local transition = 0
    if lastFrameTime ~= nil then
        transition = math.clamp(data.time - lastFrameTime, 0.18, 1.2)
    end

    for _, jointName in ipairs(JOINTS) do
        local motor = currentMotors[jointName]
        local pose = data.joints[jointName]

        if motor and pose then
            local target = toCFrame(pose)
            if activeTweens[jointName] then
                pcall(function()
                    activeTweens[jointName]:Cancel()
                end)
            end

            if transition <= 0 then
                motor.Transform = target
            else
                local tween = TweenService:Create(
                    motor,
                    TweenInfo.new(transition, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut),
                    { Transform = target }
                )
                activeTweens[jointName] = tween
                tween:Play()
            end
        end
    end

    lastFrameTime = data.time
end

local function resetSessionUi()
    running = false
    awaitingApproval = false
    sessionId = nil
    startButton.Active = true
    startButton.AutoButtonColor = true
    approveButton.Visible = false
    cancelButton.Visible = false
end

local function handleEvent(event)
    local eventType = event.type

    if eventType == "status" then
        statusLabel.Text = "Estado: " .. tostring(event.status or "trabajando")
        if event.progress then
            progressLabel.Text = string.format("Progreso: %d%% · Keyframes: %d", event.progress, keyframeCount)
        end
        return
    end

    if eventType == "meta" then
        if not currentSequence then
            createSequence(event.name)
        end
        statusLabel.Text = "Generando: " .. tostring(event.name)
        return
    end

    if eventType == "keyframe" then
        addSequenceKeyframe(event)
        keyframeCount += 1
        applyLiveKeyframe(event)
        progressLabel.Text = string.format(
            "Progreso: %d%% · Keyframes: %d",
            math.floor(tonumber(event.progress) or 0),
            keyframeCount
        )
        statusLabel.Text = "La IA está construyendo la animación sobre el dummy…"
        return
    end

    if eventType == "checkpoint" then
        awaitingApproval = true
        approveButton.Visible = true
        statusLabel.Text = "80% completado. Revisa el dummy en el viewport y aprueba para continuar."
        progressLabel.Text = string.format("Progreso: 80%% · Keyframes: %d", keyframeCount)
        return
    end

    if eventType == "complete" then
        progressLabel.Text = string.format("Progreso: 100%% · Keyframes: %d", keyframeCount)
        statusLabel.Text = "Animación terminada. KeyframeSequence editable en ServerStorage/R6LiveAnimations."
        resetSessionUi()
        return
    end

    if eventType == "error" then
        statusLabel.Text = "Error: " .. tostring(event.error or "No se pudo completar la animación.")
        resetSessionUi()
        return
    end

    if eventType == "cancelled" then
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
            statusLabel.Text = "Conexión perdida: " .. tostring(err)
            resetSessionUi()
            break
        end

        for _, event in ipairs(data.events or {}) do
            lastSequence = math.max(lastSequence, tonumber(event.sequence) or lastSequence)
            handleEvent(event)
        end

        if data.status == "error" or data.status == "complete" or data.status == "cancelled" then
            if running then
                resetSessionUi()
            end
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

    local health, healthError = requestJson("GET", BASE_URL .. "/health")
    if not health then
        statusLabel.Text = "No se encuentra el servidor local. Ejecuta npm start en la carpeta ia. " .. tostring(healthError)
        return
    end

    if not health.apiKeyConfigured then
        statusLabel.Text = "Falta GEMINI_API_KEY en ia/.env."
        return
    end

    currentRig = rig
    currentMotors = motors
    selectedRigLabel.Text = "Rig: " .. rig.Name .. " (R6)"
    lastFrameTime = nil
    currentSequence = nil
    keyframeCount = 0
    lastSequence = 0

    for _, tween in pairs(activeTweens) do
        pcall(function() tween:Cancel() end)
    end
    activeTweens = {}

    local payload = {
        description = description,
        rig = inspectRig(rig, motors)
    }

    local result, err = requestJson("POST", BASE_URL .. "/api/animations", payload)
    if not result or not result.sessionId then
        statusLabel.Text = "No se pudo iniciar: " .. tostring(err or result.error)
        return
    end

    sessionId = result.sessionId
    running = true
    awaitingApproval = false
    startButton.Active = false
    startButton.AutoButtonColor = false
    approveButton.Visible = false
    cancelButton.Visible = true
    statusLabel.Text = "Petición enviada a Gemini 4 Argon. Preparando las primeras poses…"
    progressLabel.Text = "Progreso: 0% · Keyframes: 0"

    task.spawn(pollSession)
end

local function approveAnimation()
    if not running or not awaitingApproval or not sessionId then return end

    approveButton.Visible = false
    statusLabel.Text = "Aprobado. Gemini está terminando el último 20%…"

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

print("[R6 Live Animator] Plugin cargado. Selecciona un dummy R6 y describe la animación.")
