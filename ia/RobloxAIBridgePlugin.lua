local HttpService = game:GetService("HttpService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local StudioTestService = game:GetService("StudioTestService")
local LogService = game:GetService("LogService")

local BASE_URL = "http://127.0.0.1:3000"
local NEXT_URL = BASE_URL .. "/next"
local HEALTH_URL = BASE_URL .. "/health"
local PROJECT_SCAN_URL = "http://127.0.0.1:3001/project-scan"
local TEST_RESULTS_URL = BASE_URL .. "/test-results"

local toolbar = plugin:CreateToolbar("Roblox AI")
local button = toolbar:CreateButton(
	"Roblox AI",
	"Conectar Roblox Studio con OmniRoute",
	""
)
button.ClickableWhenViewportHidden = true

local conectado = false
local consultando = false
local escaneando = false
local ultimoEscaneo = 0
local INTERVALO_ESCANEO = 300

local MAX_SOURCE_CHARS = 340000
local MAX_BATCH_CHARS = 700000
local MAX_SCRIPTS_PER_BATCH = 25
local MAX_OBJECTS = 1500
local EXTENDED_MARKER = "__ROBLOX_AI_EXTENDED_ACTION__"

local SERVICIOS = {
	ServerScriptService = game:GetService("ServerScriptService"),
	ServerStorage = game:GetService("ServerStorage"),
	ReplicatedStorage = game:GetService("ReplicatedStorage"),
	StarterGui = game:GetService("StarterGui"),
	StarterPlayer = game:GetService("StarterPlayer"),
	StarterPack = game:GetService("StarterPack"),
	Workspace = workspace,
	SoundService = game:GetService("SoundService"),
	Lighting = game:GetService("Lighting"),
	ReplicatedFirst = game:GetService("ReplicatedFirst"),
	Teams = game:GetService("Teams"),
	TextChatService = game:GetService("TextChatService"),
	Chat = game:GetService("Chat")
}

local TIPOS_SCRIPT = {
	create_script = "Script",
	create_local_script = "LocalScript",
	create_module_script = "ModuleScript",
	update_script = "Script",
	update_local_script = "LocalScript",
	update_module_script = "ModuleScript",
	delete_script = "Script",
	delete_local_script = "LocalScript",
	delete_module_script = "ModuleScript"
}

local TIPOS_REMOTOS = {
	create_remote_event = "RemoteEvent",
	create_remote_function = "RemoteFunction",
	delete_remote_event = "RemoteEvent",
	delete_remote_function = "RemoteFunction"
}

local CLASES_OBJETOS = {
	Folder = true,
	Model = true,
	Part = true,
	MeshPart = true,
	UnionOperation = true,
	Tool = true,
	RemoteEvent = true,
	RemoteFunction = true,
	BindableEvent = true,
	BindableFunction = true,
	Attachment = true,
	Motor6D = true,
	WeldConstraint = true,
	ProximityPrompt = true,
	ScreenGui = true,
	Frame = true,
	TextLabel = true,
	TextButton = true,
	TextBox = true,
	ImageLabel = true,
	ImageButton = true
}

local CLASES_CREABLES = {
	Folder = true,
	Model = true,
	Part = true,
	MeshPart = true,
	Tool = true,
	RemoteEvent = true,
	RemoteFunction = true,
	BindableEvent = true,
	BindableFunction = true,
	Attachment = true,
	Motor6D = true,
	WeldConstraint = true,
	ProximityPrompt = true,
	ScreenGui = true,
	Frame = true,
	TextLabel = true,
	TextButton = true,
	TextBox = true,
	ImageLabel = true,
	ImageButton = true
}

local function debeIgnorar(objeto)
	local nombre = string.lower(objeto.Name or "")
	local ruta = string.lower(objeto:GetFullName() or "")

	return nombre == "robloxaibridgeplugin"
		or string.find(nombre, "geminibridgeplugin", 1, true) ~= nil
		or string.find(ruta, "geminibridgeplugin", 1, true) ~= nil
		or string.find(ruta, "roblox ai bridge", 1, true) ~= nil
end

local function obtenerContenedor(ruta, crearCarpetas)
	if type(ruta) ~= "string" or ruta == "" or string.find(ruta, "..", 1, true) then
		return nil
	end

	local partes = string.split(ruta, "/")
	local actual = SERVICIOS[partes[1]]
	if not actual then
		return nil
	end

	for i = 2, #partes do
		local nombre = partes[i]
		if nombre ~= "" then
			local siguiente = actual:FindFirstChild(nombre)
			if not siguiente then
				if not crearCarpetas then
					return nil
				end
				siguiente = Instance.new("Folder")
				siguiente.Name = nombre
				siguiente.Parent = actual
			end
			actual = siguiente
		end
	end

	return actual
end

local function obtenerInstancia(ruta, nombre)
	local contenedor = obtenerContenedor(ruta, false)
	if not contenedor or type(nombre) ~= "string" or nombre == "" then
		return nil
	end
	return contenedor:FindFirstChild(nombre)
end

local function obtenerRutaDesdeRaiz(objeto, raiz, nombreRaiz)
	local partes = {}
	local actual = objeto

	while actual and actual ~= raiz do
		table.insert(partes, 1, actual.Name)
		actual = actual.Parent
	end

	if actual ~= raiz then
		return nil
	end

	table.insert(partes, 1, nombreRaiz)
	return table.concat(partes, "/")
end

local function obtenerRuta(objeto)
	local padre = objeto.Parent
	if not padre then
		return nil
	end

	for nombreRaiz, raiz in pairs(SERVICIOS) do
		local ruta = obtenerRutaDesdeRaiz(padre, raiz, nombreRaiz)
		if ruta then
			return ruta
		end
	end

	return nil
end

local function obtenerSource(objeto)
	local ok, source = pcall(function()
		return ScriptEditorService:GetEditorSource(objeto)
	end)

	if ok and type(source) == "string" then
		return source
	end

	local okFallback, sourceFallback = pcall(function()
		return objeto.Source
	end)

	if okFallback and type(sourceFallback) == "string" then
		return sourceFallback
	end

	return nil
end

local function recolectarScripts()
	local resultado = {}

	for _, raiz in pairs(SERVICIOS) do
		for _, objeto in ipairs(raiz:GetDescendants()) do
			if not debeIgnorar(objeto)
				and (objeto:IsA("Script") or objeto:IsA("LocalScript") or objeto:IsA("ModuleScript")) then

				local ruta = obtenerRuta(objeto)
				local source = obtenerSource(objeto)

				if ruta and source and #source <= MAX_SOURCE_CHARS then
					table.insert(resultado, {
						className = objeto.ClassName,
						name = objeto.Name,
						path = ruta,
						source = source
					})
				end
			end
		end
	end

	table.sort(resultado, function(a, b)
		return (a.path .. "/" .. a.name) < (b.path .. "/" .. b.name)
	end)

	return resultado
end

local function recolectarObjetosImportantes()
	local resultado = {}

	for _, raiz in pairs(SERVICIOS) do
		for _, objeto in ipairs(raiz:GetDescendants()) do
			if #resultado >= MAX_OBJECTS then
				break
			end

			if not debeIgnorar(objeto) and CLASES_OBJETOS[objeto.ClassName] then
				local ruta = obtenerRuta(objeto)
				if ruta then
					table.insert(resultado, {
						className = objeto.ClassName,
						name = objeto.Name,
						path = ruta
					})
				end
			end
		end
	end

	table.sort(resultado, function(a, b)
		return (a.path .. "/" .. a.name) < (b.path .. "/" .. b.name)
	end)

	return resultado
end

local function dividirLotes(scripts)
	local lotes = {}
	local actual = {}
	local caracteres = 0

	for _, scriptData in ipairs(scripts) do
		local costo = #scriptData.source + #scriptData.path + #scriptData.name + 150
		local superaTamano = #actual > 0 and caracteres + costo > MAX_BATCH_CHARS
		local superaCantidad = #actual >= MAX_SCRIPTS_PER_BATCH

		if superaTamano or superaCantidad then
			table.insert(lotes, actual)
			actual = {}
			caracteres = 0
		end

		table.insert(actual, scriptData)
		caracteres += costo
	end

	if #actual > 0 then
		table.insert(lotes, actual)
	end

	return lotes
end

local function enviarEscaneo(scripts, objects, reset)
	local ok, respuesta = pcall(function()
		return HttpService:RequestAsync({
			Url = PROJECT_SCAN_URL,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["Accept"] = "application/json"
			},
			Body = HttpService:JSONEncode({
				reset = reset == true,
				scripts = scripts,
				objects = objects or {}
			})
		})
	end)

	if not ok or not respuesta.Success then
		warn("[Roblox AI] Error enviando contexto:", ok and respuesta.Body or respuesta)
		return false
	end

	return true
end

local function escanearProyecto()
	if escaneando or not conectado then
		return false
	end

	escaneando = true

	local scripts = recolectarScripts()
	local objects = recolectarObjetosImportantes()
	local lotes = dividirLotes(scripts)
	local correcto = true

	if #lotes == 0 then
		correcto = enviarEscaneo({}, objects, true)
	else
		for indice, lote in ipairs(lotes) do
			if not enviarEscaneo(lote, indice == 1 and objects or {}, indice == 1) then
				correcto = false
				break
			end
			task.wait(0.05)
		end
	end

	if correcto then
		ultimoEscaneo = os.clock()
		print("[Roblox AI] âœ… Contexto actualizado:", #scripts, "scripts |", #objects, "objetos detectados")
	end

	escaneando = false
	return correcto
end

local function comprobarServidor()
	local ok, respuesta = pcall(function()
		return HttpService:RequestAsync({
			Url = HEALTH_URL,
			Method = "GET"
		})
	end)

	if not ok or not respuesta.Success then
		warn("[Roblox AI] No se pudo conectar al servidor OmniRoute:", ok and respuesta.Body or respuesta)
		return false
	end

	local datosOk, datos = pcall(function()
		return HttpService:JSONDecode(respuesta.Body)
	end)

	if not datosOk or type(datos) ~= "table" then
		warn("[Roblox AI] /health devolviÃ³ datos invÃ¡lidos.")
		return false
	end

	if datos.ok ~= true then
		warn("[Roblox AI] OmniRoute no estÃ¡ disponible.")
		return false
	end

	print("[Roblox AI] âœ… OmniRoute:", tostring(datos.model))
	print("[Roblox AI] ðŸ§  Reasoning:", tostring(datos.reasoningEffort))
	return true
end

local function actualizarSource(objeto, code)
	local ok, err = pcall(function()
		ScriptEditorService:UpdateSourceAsync(objeto, function()
			return code
		end)
	end)

	if not ok then
		warn("[Roblox AI] No se pudo actualizar Source:", err)
		return false
	end

	return true
end

local function ejecutarScriptAction(action)
	local tipo = TIPOS_SCRIPT[action.type]
	if not tipo then
		return false
	end

	local ruta = tostring(action.path or "")
	local nombre = tostring(action.name or "")
	local crear = action.type:sub(1, 7) == "create_"
	local contenedor = obtenerContenedor(ruta, crear)

	if not contenedor or nombre == "" then
		warn("[Roblox AI] Ruta invÃ¡lida:", ruta, nombre)
		return false
	end

	local existente = contenedor:FindFirstChild(nombre)

	if crear then
		if existente then
			warn("[Roblox AI] CREATE rechazado: ya existe", existente:GetFullName(), existente.ClassName)
			return false
		end

		if type(action.code) ~= "string" or action.code == "" then
			return false
		end

		local nuevo = Instance.new(tipo)
		nuevo.Name = nombre
		nuevo.Source = action.code
		nuevo.Parent = contenedor

		if nuevo:IsA("Script") or nuevo:IsA("LocalScript") then
			nuevo.Enabled = true
		end

		print("[Roblox AI] âœ… CREADO:", nuevo:GetFullName())
		ChangeHistoryService:SetWaypoint("OmniRoute crear " .. nombre)
		return true
	end

	if action.type:sub(1, 7) == "update_" then
		if not existente or existente.ClassName ~= tipo then
			warn("[Roblox AI] UPDATE rechazado:", ruta .. "/" .. nombre)
			return false
		end

		if type(action.code) ~= "string" or action.code == "" then
			return false
		end

		if actualizarSource(existente, action.code) then
			if existente:IsA("Script") or existente:IsA("LocalScript") then
				existente.Enabled = true
			end
			print("[Roblox AI] âœï¸ ACTUALIZADO:", existente:GetFullName())
			ChangeHistoryService:SetWaypoint("OmniRoute actualizar " .. nombre)
			return true
		end

		return false
	end

	if action.type:sub(1, 7) == "delete_" then
		if not existente or existente.ClassName ~= tipo then
			warn("[Roblox AI] DELETE rechazado:", ruta .. "/" .. nombre)
			return false
		end

		local fullName = existente:GetFullName()
		existente:Destroy()
		print("[Roblox AI] ðŸ—‘ï¸ ELIMINADO:", fullName)
		ChangeHistoryService:SetWaypoint("OmniRoute eliminar " .. nombre)
		return true
	end

	return false
end

local function ejecutarRemoteAction(action)
	local clase = TIPOS_REMOTOS[action.type]
	if not clase then
		return false
	end

	local ruta = tostring(action.path or "")
	local nombre = tostring(action.name or "")
	local crear = action.type:sub(1, 7) == "create_"
	local contenedor = obtenerContenedor(ruta, crear)

	if not contenedor or nombre == "" then
		return false
	end

	local existente = contenedor:FindFirstChild(nombre)

	if crear then
		if existente then
			if existente.ClassName == clase then
				print("[Roblox AI] â„¹ï¸ Ya existe:", existente:GetFullName())
				return true
			end
			warn("[Roblox AI] CREATE REMOTE rechazado: ya existe otro objeto con ese nombre.")
			return false
		end

		local nuevo = Instance.new(clase)
		nuevo.Name = nombre
		nuevo.Parent = contenedor
		print("[Roblox AI] âœ… CREADO:", nuevo:GetFullName(), "(" .. clase .. ")")
		ChangeHistoryService:SetWaypoint("OmniRoute crear " .. nombre)
		return true
	end

	if not existente or existente.ClassName ~= clase then
		warn("[Roblox AI] DELETE REMOTE rechazado:", ruta .. "/" .. nombre)
		return false
	end

	existente:Destroy()
	print("[Roblox AI] ðŸ—‘ï¸ REMOTO ELIMINADO:", ruta .. "/" .. nombre)
	ChangeHistoryService:SetWaypoint("OmniRoute eliminar " .. nombre)
	return true
end

local function ejecutarCarpeta(action)
	local ruta = tostring(action.path or "")
	local nombre = tostring(action.name or "")

	if nombre == "" or string.find(nombre, "/", 1, true) or string.find(nombre, "\\", 1, true) then
		return false
	end

	if action.type == "create_folder" then
		local contenedor = obtenerContenedor(ruta, true)
		if not contenedor then return false end
		if contenedor:FindFirstChild(nombre) then return true end

		local carpeta = Instance.new("Folder")
		carpeta.Name = nombre
		carpeta.Parent = contenedor
		print("[Roblox AI] ðŸ“ CARPETA CREADA:", carpeta:GetFullName())
		ChangeHistoryService:SetWaypoint("OmniRoute crear carpeta " .. nombre)
		return true
	end

	if action.type == "delete_folder" then
		local contenedor = obtenerContenedor(ruta, false)
		if not contenedor then return false end

		local carpeta = contenedor:FindFirstChild(nombre)
		if not carpeta or not carpeta:IsA("Folder") then return false end

		carpeta:Destroy()
		print("[Roblox AI] ðŸ—‘ï¸ CARPETA ELIMINADA:", ruta .. "/" .. nombre)
		ChangeHistoryService:SetWaypoint("OmniRoute eliminar carpeta " .. nombre)
		return true
	end

	return false
end

local function convertirValor(valor)
	if type(valor) ~= "table" then
		return valor
	end

	local tipo = tostring(valor.type or "")

	if tipo == "Vector2" then
		return Vector2.new(tonumber(valor.x) or 0, tonumber(valor.y) or 0)
	elseif tipo == "Vector3" then
		return Vector3.new(tonumber(valor.x) or 0, tonumber(valor.y) or 0, tonumber(valor.z) or 0)
	elseif tipo == "Color3" then
		return Color3.new(tonumber(valor.r) or 0, tonumber(valor.g) or 0, tonumber(valor.b) or 0)
	elseif tipo == "CFrame" then
		return CFrame.new(
			tonumber(valor.x) or 0,
			tonumber(valor.y) or 0,
			tonumber(valor.z) or 0
		) * CFrame.Angles(
			math.rad(tonumber(valor.rx) or 0),
			math.rad(tonumber(valor.ry) or 0),
			math.rad(tonumber(valor.rz) or 0)
		)
	elseif tipo == "UDim2" then
		return UDim2.new(
			tonumber(valor.xScale) or 0,
			tonumber(valor.xOffset) or 0,
			tonumber(valor.yScale) or 0,
			tonumber(valor.yOffset) or 0
		)
	elseif tipo == "BrickColor" then
		return BrickColor.new(tostring(valor.value or "Medium stone grey"))
	elseif tipo == "Enum" then
		local enumNombre = tostring(valor.enum or "")
		local enumValor = tostring(valor.value or "")
		local enumObjeto = Enum[enumNombre]
		if enumObjeto then
			local enumItem = enumObjeto[enumValor]
			if enumItem then
				return enumItem
			end
		end
		return nil
	end

	return valor
end

local function propiedadPermitida(nombre)
	if type(nombre) ~= "string" or nombre == "" then
		return false
	end

	return nombre ~= "Parent"
		and nombre ~= "ClassName"
		and nombre ~= "Source"
		and nombre ~= "Archivable"
end

local function aplicarPropiedad(objeto, nombre, valor)
	if not objeto or not propiedadPermitida(nombre) then
		return false
	end

	local convertido = convertirValor(valor)
	if convertido == nil and type(valor) == "table" then
		warn("[Roblox AI] Valor tipado invÃ¡lido para propiedad:", nombre)
		return false
	end

	local ok, errorMensaje = pcall(function()
		objeto[nombre] = convertido
	end)

	if not ok then
		warn(
			"[Roblox AI] No se pudo cambiar propiedad:",
			objeto:GetFullName(),
			nombre,
			errorMensaje
		)
		return false
	end

	print("[Roblox AI] âš™ï¸ PROPIEDAD:", objeto:GetFullName(), nombre, "=", tostring(convertido))
	return true
end

local function aplicarPropiedades(objeto, propiedades)
	if type(propiedades) ~= "table" then
		return 0
	end

	local total = 0
	for nombre, valor in pairs(propiedades) do
		if aplicarPropiedad(objeto, tostring(nombre), valor) then
			total += 1
		end
	end
	return total
end

local function claseCoincide(objeto, className)
	if not className or className == "" then
		return true
	end
	return objeto.ClassName == className
end

local function enviarResultadoPrueba(resultado)
	local ok, respuesta = pcall(function()
		return HttpService:RequestAsync({
			Url = TEST_RESULTS_URL,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["Accept"] = "application/json"
			},
			Body = HttpService:JSONEncode(resultado)
		})
	end)

	if not ok or not respuesta.Success then
		warn("[Roblox AI] No se pudo enviar resultado de prueba:", ok and respuesta.Body or respuesta)
		return false
	end

	return true
end

local function obtenerLogsDePrueba()
	local historial = {}

	local ok, datos = pcall(function()
		return LogService:GetLogHistory()
	end)

	if not ok or type(datos) ~= "table" then
		return historial
	end

	for i = math.max(1, #datos - 100), #datos do
		local entrada = datos[i]

		if type(entrada) == "table" then
			table.insert(historial, {
				message = tostring(entrada.message or ""),
				messageType = tostring(entrada.messageType or ""),
				timestamp = tonumber(entrada.timestamp) or 0,
				context = entrada.context
			})
		end
	end

	return historial
end

local function ejecutarStudioTest(action)
	if type(action) ~= "table" then
		return false
	end

	local testId = tostring(action.testId or "")
	local numPlayers = math.max(1, math.min(8, tonumber(action.numPlayers) or 2))
	local duration = math.max(3, math.min(60, tonumber(action.duration) or 10))
	local serverCode = tostring(action.serverCode or "")
	local clientCode = tostring(action.clientCode or "")

	if testId == "" then
		warn("[Roblox AI] run_studio_test sin testId")
		return false
	end

	print("=================================")
	print("[Roblox AI] 🧪 INICIANDO PRUEBA")
	print("[Roblox AI] Test:", testId)
	print("[Roblox AI] Servidor +", numPlayers, "cliente(s)")
	print("[Roblox AI] Duración máxima:", duration, "segundos")
	print("=================================")

	local token = string.gsub(testId, "[^%w_]", "_")
	local folderName = "__RobloxAI_Test_" .. token
	local serverName = folderName .. "_Server"
	local clientName = folderName .. "_Client"

	local testFolder = Instance.new("Folder")
	testFolder.Name = folderName
	testFolder.Parent = game:GetService("ReplicatedStorage")

	local reportEvent = Instance.new("RemoteEvent")
	reportEvent.Name = "Report"
	reportEvent.Parent = testFolder

	local serverScript = Instance.new("Script")
	serverScript.Name = serverName

	serverScript.Source = [[
local Players = game:GetService("Players")
local StudioTestService = game:GetService("StudioTestService")

local folder = script.Parent
local report = folder:WaitForChild("Report")

local finished = false
local serverFinished = false
local reports = {}

local function terminar(ok, mensaje)
    if finished then
        return
    end

    finished = true
    StudioTestService:EndTest({
        ok = ok,
        message = mensaje,
        reports = reports
    })
end

report.OnServerEvent:Connect(function(player, ok, mensaje)
    reports[player.UserId] = {
        player = player.Name,
        ok = ok == true,
        message = tostring(mensaje or "")
    }

    print("[Roblox AI TEST][CLIENT]", player.Name, ok, mensaje)

    local required = ]] .. tostring(numPlayers) .. [[
    local total = 0

    for _ in pairs(reports) do
        total += 1
    end

    if serverFinished and total >= required then
        local todosOk = true

        for _, resultado in pairs(reports) do
            if not resultado.ok then
                todosOk = false
                break
            end
        end

        terminar(todosOk, todosOk and "Todos los clientes pasaron." or "Un cliente falló.")
    end
end)

task.spawn(function()
    local ok, errorMessage = pcall(function()
]] .. serverCode .. [[
    end)

    serverFinished = true

    if not ok then
        warn("[Roblox AI TEST][SERVER ERROR]", errorMessage)
        terminar(false, tostring(errorMessage))
        return
    end

    print("[Roblox AI TEST][SERVER] Prueba del servidor completada.")

    local total = 0

    for _ in pairs(reports) do
        total += 1
    end

    if total >= ]] .. tostring(numPlayers) .. [[ then
        local todosOk = true

        for _, resultado in pairs(reports) do
            if not resultado.ok then
                todosOk = false
                break
            end
        end

        terminar(todosOk, todosOk and "Servidor y clientes OK." or "Un cliente falló.")
    end
end)

task.delay(]] .. tostring(duration) .. [[, function()
    if not finished then
        warn("[Roblox AI TEST] Timeout")
        terminar(false, "Timeout de prueba.")
    end
end)
]]

	serverScript.Parent = testFolder

	local clientScript = Instance.new("LocalScript")
	clientScript.Name = clientName

	clientScript.Source = [[
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local folder = ReplicatedStorage:WaitForChild("]] .. folderName .. [[")
local report = folder:WaitForChild("Report")

task.spawn(function()
    local ok, errorMessage = pcall(function()
]] .. clientCode .. [[
    end)

    if ok then
        print("[Roblox AI TEST][CLIENT] PASS:", player.Name)
        report:FireServer(true, "Cliente OK")
    else
        warn("[Roblox AI TEST][CLIENT ERROR]", errorMessage)
        report:FireServer(false, tostring(errorMessage))
    end
end)
]]

	clientScript.Parent = game:GetService("StarterPlayer"):WaitForChild("StarterPlayerScripts")

	local inicio = os.clock()

	local okRun, result = pcall(function()
		return StudioTestService:ExecuteMultiplayerTestAsync(numPlayers, duration)
	end)

	local duracionReal = os.clock() - inicio
	local logs = obtenerLogsDePrueba()

	local errores = 0
	local advertencias = 0

	for _, entrada in ipairs(logs) do
		local tipo = string.lower(tostring(entrada.messageType))

		if string.find(tipo, "error", 1, true) then
			errores += 1
		elseif string.find(tipo, "warning", 1, true) then
			advertencias += 1
		end
	end

	local resultadoPrueba = {
		testId = testId,
		ok = okRun and errores == 0,
		executionOk = okRun,
		result = result,
		duration = duracionReal,
		numPlayers = numPlayers,
		errorCount = errores,
		warningCount = advertencias,
		logs = logs
	}

	if okRun then
		print("[Roblox AI] ✅ PRUEBA TERMINADA")
	else
		warn("[Roblox AI] ❌ PRUEBA FALLÓ:", result)
	end

	print("[Roblox AI] Errores:", errores, "Advertencias:", advertencias)

	pcall(function()
		testFolder:Destroy()
	end)

	enviarResultadoPrueba(resultadoPrueba)

	return resultadoPrueba.ok
end
local function ejecutarExtendedAction(action)
	if type(action) ~= "table" then
		return false
	end

	local tipo = tostring(action.type or ""):lower()

	if tipo == "run_studio_test" then
		return ejecutarStudioTest(action)
	end
	local ruta = tostring(action.path or "")
	local nombre = tostring(action.name or "")

	if tipo == "create_instance" then
		local className = tostring(action.className or "")
		if not CLASES_CREABLES[className] then
			warn("[Roblox AI] Clase no permitida para create_instance:", className)
			return false
		end

		local contenedor = obtenerContenedor(ruta, true)
		if not contenedor or nombre == "" then
			return false
		end

		local existente = contenedor:FindFirstChild(nombre)
		if existente then
			if existente.ClassName == className then
				aplicarPropiedades(existente, action.properties)
				print("[Roblox AI] â„¹ï¸ Instancia ya existente:", existente:GetFullName())
				return true
			end
			warn("[Roblox AI] CREATE_INSTANCE rechazado: ya existe otro objeto con ese nombre.")
			return false
		end

		local okCrear, nuevo = pcall(function()
			local instancia = Instance.new(className)
			instancia.Name = nombre
			instancia.Parent = contenedor
			return instancia
		end)

		if not okCrear or not nuevo then
			warn("[Roblox AI] No se pudo crear instancia:", className, nuevo)
			return false
		end

		local propiedadesAplicadas = aplicarPropiedades(nuevo, action.properties)
		print("[Roblox AI] âœ… INSTANCIA CREADA:", nuevo:GetFullName(), "(" .. className .. ")", "propiedades:", propiedadesAplicadas)
		ChangeHistoryService:SetWaypoint("OmniRoute crear instancia " .. nombre)
		return true
	end

	local objeto = obtenerInstancia(ruta, nombre)
	if not objeto then
		warn("[Roblox AI] Objeto no encontrado:", ruta .. "/" .. nombre)
		return false
	end

	if not claseCoincide(objeto, action.className) then
		warn(
			"[Roblox AI] ClassName no coincide:",
			objeto:GetFullName(),
			"real=", objeto.ClassName,
			"esperado=", tostring(action.className)
		)
		return false
	end

	if tipo == "set_property" then
		local ok = aplicarPropiedad(objeto, tostring(action.property or ""), action.value)
		if ok then ChangeHistoryService:SetWaypoint("OmniRoute propiedad " .. objeto.Name) end
		return ok
	end

	if tipo == "set_properties" then
		local total = aplicarPropiedades(objeto, action.properties)
		if total > 0 then ChangeHistoryService:SetWaypoint("OmniRoute propiedades " .. objeto.Name) end
		return total > 0
	end

	if tipo == "rename_instance" then
		local nuevoNombre = tostring(action.newName or "")
		if nuevoNombre == "" or string.find(nuevoNombre, "/", 1, true) or string.find(nuevoNombre, "\\", 1, true) then
			return false
		end

		local padre = objeto.Parent
		if not padre or padre:FindFirstChild(nuevoNombre) then
			warn("[Roblox AI] RENOMBRAR rechazado: nombre ocupado o sin padre.")
			return false
		end

		local anterior = objeto:GetFullName()
		objeto.Name = nuevoNombre
		print("[Roblox AI] âœï¸ RENOMBRADO:", anterior, "â†’", objeto:GetFullName())
		ChangeHistoryService:SetWaypoint("OmniRoute renombrar " .. nuevoNombre)
		return true
	end

	if tipo == "move_instance" then
		local targetPath = tostring(action.targetPath or "")
		local destino = obtenerContenedor(targetPath, false)
		if not destino then
			warn("[Roblox AI] Destino no encontrado:", targetPath)
			return false
		end

		if destino == objeto or objeto:IsDescendantOf(destino) then
			warn("[Roblox AI] MOVE rechazado: destino dentro del propio objeto.")
			return false
		end

		if destino:FindFirstChild(objeto.Name) then
			warn("[Roblox AI] MOVE rechazado: ya existe el mismo nombre en destino.")
			return false
		end

		local anterior = objeto:GetFullName()
		objeto.Parent = destino
		print("[Roblox AI] ðŸ“¦ MOVIDO:", anterior, "â†’", objeto:GetFullName())
		ChangeHistoryService:SetWaypoint("OmniRoute mover " .. objeto.Name)
		return true
	end

	if tipo == "delete_instance" then
		local fullName = objeto:GetFullName()
		objeto:Destroy()
		print("[Roblox AI] ðŸ—‘ï¸ INSTANCIA ELIMINADA:", fullName)
		ChangeHistoryService:SetWaypoint("OmniRoute eliminar " .. nombre)
		return true
	end

	warn("[Roblox AI] AcciÃ³n extendida desconocida:", tipo)
	return false
end

local function intentarAccionExtendidaEmpaquetada(action)
	if type(action) ~= "table" or action.type ~= "update_script" or type(action.code) ~= "string" then
		return false
	end

	if string.sub(action.code, 1, #EXTENDED_MARKER) ~= EXTENDED_MARKER then
		return false
	end

	local json = string.sub(action.code, #EXTENDED_MARKER + 2)
	local ok, extended = pcall(function()
		return HttpService:JSONDecode(json)
	end)

	if not ok or type(extended) ~= "table" then
		warn("[Roblox AI] AcciÃ³n extendida empaquetada invÃ¡lida.")
		return true
	end

	ejecutarExtendedAction(extended)
	return true
end

local function ejecutarAccion(action)
	if type(action) ~= "table" then
		return
	end

	if intentarAccionExtendidaEmpaquetada(action) then
		return
	end

	local tipo = tostring(action.type or "")

	if TIPOS_SCRIPT[tipo] then
		ejecutarScriptAction(action)
	elseif TIPOS_REMOTOS[tipo] then
		ejecutarRemoteAction(action)
	elseif tipo == "create_folder" or tipo == "delete_folder" then
		ejecutarCarpeta(action)
	else
		warn("[Roblox AI] AcciÃ³n desconocida:", tipo)
	end
end

local function consultarServidor()
	if consultando or not conectado then
		return
	end

	consultando = true

	local ok, respuesta = pcall(function()
		return HttpService:RequestAsync({
			Url = NEXT_URL,
			Method = "GET"
		})
	end)

	consultando = false

	if not ok or not respuesta.Success then
		return
	end

	local jsonOk, datos = pcall(function()
		return HttpService:JSONDecode(respuesta.Body)
	end)

	if not jsonOk or type(datos) ~= "table" or type(datos.actions) ~= "table" then
		return
	end

	if #datos.actions == 0 then
		return
	end

	print("[Roblox AI] ðŸ“¥ Acciones Groq:", #datos.actions)
	ChangeHistoryService:SetWaypoint("Antes de cambios OmniRoute")

	for _, action in ipairs(datos.actions) do
		local okAction, errorAction = pcall(function()
			ejecutarAccion(action)
		end)

		if not okAction then
			warn("[Roblox AI] Error ejecutando acciÃ³n:", errorAction)
		end
	end

	ChangeHistoryService:SetWaypoint("Cambios OmniRoute completados")
	escanearProyecto()
end

local function iniciarLoops()
	task.spawn(function()
		while conectado do
			consultarServidor()
			task.wait(1)
		end
	end)

	task.spawn(function()
		while conectado do
			if os.clock() - ultimoEscaneo >= INTERVALO_ESCANEO then
				escanearProyecto()
			end
			task.wait(5)
		end
	end)
end

button.Click:Connect(function()
	if conectado then
		conectado = false
		button:SetActive(false)
		print("[Roblox AI] ðŸ”Œ DESCONECTADO")
		return
	end

	if not comprobarServidor() then
		return
	end

	conectado = true
	button:SetActive(true)

	print("=================================")
	print("[Roblox AI] ðŸŸ¢ CONECTADO")
	print("[Roblox AI] Proveedor: OmniRoute")
	print("[Roblox AI] Modelo: auto")
	print("[Roblox AI] Funciones: scripts + remotes + instancias + propiedades")
	print("[Roblox AI] Escaneo: al conectar + cada 5 minutos")
	print("=================================")

	escanearProyecto()
	iniciarLoops()
end)
