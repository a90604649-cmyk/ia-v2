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

local INTERVALO_ESCANEO = 300
local MAX_SOURCE_CHARS = 340000
local MAX_BATCH_CHARS = 700000
local MAX_SCRIPTS_PER_BATCH = 25
local MAX_OBJECTS = 1500

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

local SCRIPT_TYPES = {
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

local REMOTE_TYPES = {
	create_remote_event = "RemoteEvent",
	create_remote_function = "RemoteFunction",
	delete_remote_event = "RemoteEvent",
	delete_remote_function = "RemoteFunction"
}

local function debeIgnorar(objeto)
	local nombre = string.lower(objeto.Name or "")
	local ruta = string.lower(objeto:GetFullName() or "")

	return nombre == "robloxaibridgeplugin"
		or string.find(nombre, "geminibridgeplugin", 1, true) ~= nil
		or string.find(ruta, "geminibridgeplugin", 1, true) ~= nil
		or string.find(ruta, "roblox ai bridge", 1, true) ~= nil
		or string.find(ruta, "projectcontext", 1, true) ~= nil
end

local function obtenerContenedor(ruta, crearCarpetas)
	if type(ruta) ~= "string" or ruta == "" or string.find(ruta, "..", 1, true) then
		return nil
	end

	local partes = string.split(ruta:gsub("\\", "/"), "/")
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

	local okFallback, fallback = pcall(function()
		return objeto.Source
	end)

	if okFallback and type(fallback) == "string" then
		return fallback
	end

	return nil
end

local function actualizarSource(objeto, source)
	if type(source) ~= "string" then
		return false
	end

	local ok, err = pcall(function()
		ScriptEditorService:UpdateSourceAsync(objeto, function()
			return source
		end)
	end)

	if ok then
		return true
	end

	local okFallback, fallbackError = pcall(function()
		objeto.Source = source
	end)

	if not okFallback then
		warn("[Roblox AI] No se pudo actualizar Source:", err or fallbackError)
		return false
	end

	return true
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

local function recolectarObjetos()
	local resultado = {}

	for _, raiz in pairs(SERVICIOS) do
		for _, objeto in ipairs(raiz:GetDescendants()) do
			if #resultado >= MAX_OBJECTS then
				break
			end

			if not debeIgnorar(objeto) then
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
	local ok, response = pcall(function()
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

	if not ok or not response.Success then
		warn("[Roblox AI] Error enviando contexto:", ok and response.Body or response)
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
	local objects = recolectarObjetos()
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
		print("[Roblox AI] ✅ Contexto actualizado:", #scripts, "scripts |", #objects, "objetos detectados")
	end

	escaneando = false
	return correcto
end

local function comprobarServidor()
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = HEALTH_URL,
			Method = "GET"
		})
	end)

	if not ok or not response.Success then
		warn("[Roblox AI] No se pudo conectar al servidor:", ok and response.Body or response)
		return false
	end

	local jsonOk, data = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)

	if not jsonOk or type(data) ~= "table" or data.ok ~= true then
		warn("[Roblox AI] /health devolvio datos invalidos.")
		return false
	end

	print("[Roblox AI] ✅ OmniRoute:", tostring(data.model))
	return true
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
		local enumObjeto = Enum[tostring(valor.enum or "")]
		if enumObjeto then
			return enumObjeto[tostring(valor.value or "")]
		end
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

	local ok, err = pcall(function()
		objeto[nombre] = convertido
	end)

	if not ok then
		warn("[Roblox AI] No se pudo cambiar", objeto:GetFullName(), nombre, err)
		return false
	end

	print("[Roblox AI] ⚙ PROPIEDAD:", objeto:GetFullName(), nombre, "=", tostring(convertido))
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
	return not className or className == "" or objeto.ClassName == className
end

local function ejecutarScriptAction(action)
	local tipo = SCRIPT_TYPES[action.type]
	if not tipo then
		return false
	end

	local path = tostring(action.path or "")
	local name = tostring(action.name or "")
	local esCreate = action.type:sub(1, 7) == "create_"
	local esDelete = action.type:sub(1, 7) == "delete_"
	local container = obtenerContenedor(path, esCreate)

	if not container or name == "" then
		warn("[Roblox AI] Ruta invalida:", path, name)
		return false
	end

	local existing = container:FindFirstChild(name)

	if esCreate then
		if existing then
			warn("[Roblox AI] CREATE rechazado: ya existe", existing:GetFullName())
			return false
		end

		if type(action.code) ~= "string" or action.code == "" then
			warn("[Roblox AI] CREATE sin SOURCE completo:", path .. "/" .. name)
			return false
		end

		local ok, created = pcall(function()
			local instance = Instance.new(tipo)
			instance.Name = name
			instance.Parent = container
			return instance
		end)

		if not ok or not created then
			warn("[Roblox AI] No se pudo crear", tipo, created)
			return false
		end

		if not actualizarSource(created, action.code) then
			created:Destroy()
			return false
		end

		if created:IsA("Script") or created:IsA("LocalScript") then
			created.Enabled = true
		end

		print("[Roblox AI] ✅ CREADO:", created:GetFullName())
		ChangeHistoryService:SetWaypoint("OmniRoute crear " .. name)
		return true
	end

	if not existing or existing.ClassName ~= tipo then
		warn("[Roblox AI] Objeto de script no encontrado:", path .. "/" .. name)
		return false
	end

	if action.type:sub(1, 7) == "update_" then
		if type(action.code) ~= "string" or action.code == "" then
			warn("[Roblox AI] UPDATE sin SOURCE completo:", path .. "/" .. name)
			return false
		end

		if not actualizarSource(existing, action.code) then
			return false
		end

		if existing:IsA("Script") or existing:IsA("LocalScript") then
			existing.Enabled = true
		end

		print("[Roblox AI] ✏ ACTUALIZADO:", existing:GetFullName())
		ChangeHistoryService:SetWaypoint("OmniRoute actualizar " .. name)
		return true
	end

	if esDelete then
		local fullName = existing:GetFullName()
		existing:Destroy()
		print("[Roblox AI] 🗑 ELIMINADO:", fullName)
		ChangeHistoryService:SetWaypoint("OmniRoute eliminar " .. name)
		return true
	end

	return false
end

local function ejecutarRemoteAction(action)
	local className = REMOTE_TYPES[action.type]
	if not className then
		return false
	end

	local path = tostring(action.path or "")
	local name = tostring(action.name or "")
	local container = obtenerContenedor(path, action.type:sub(1, 7) == "create_")
	if not container or name == "" then
		return false
	end

	local existing = container:FindFirstChild(name)

	if action.type:sub(1, 7) == "create_" then
		if existing then
			return existing.ClassName == className
		end

		local ok, created = pcall(function()
			local instance = Instance.new(className)
			instance.Name = name
			instance.Parent = container
			return instance
		end)

		if not ok then
			warn("[Roblox AI] No se pudo crear remote:", created)
			return false
		end

		print("[Roblox AI] ✅ REMOTE CREADO:", created:GetFullName())
		ChangeHistoryService:SetWaypoint("OmniRoute crear remote " .. name)
		return true
	end

	if not existing or existing.ClassName ~= className then
		return false
	end

	existing:Destroy()
	print("[Roblox AI] 🗑 REMOTE ELIMINADO:", path .. "/" .. name)
	ChangeHistoryService:SetWaypoint("OmniRoute eliminar remote " .. name)
	return true
end

local function ejecutarCarpeta(action)
	local path = tostring(action.path or "")
	local name = tostring(action.name or "")

	if name == "" or string.find(name, "/", 1, true) or string.find(name, "\\", 1, true) then
		return false
	end

	if action.type == "create_folder" then
		local container = obtenerContenedor(path, true)
		if not container then return false end
		if container:FindFirstChild(name) then return true end

		local folder = Instance.new("Folder")
		folder.Name = name
		folder.Parent = container
		print("[Roblox AI] ✅ CARPETA CREADA:", folder:GetFullName())
		ChangeHistoryService:SetWaypoint("OmniRoute crear carpeta " .. name)
		return true
	end

	if action.type == "delete_folder" then
		local container = obtenerContenedor(path, false)
		if not container then return false end

		local folder = container:FindFirstChild(name)
		if not folder or not folder:IsA("Folder") then return false end

		folder:Destroy()
		print("[Roblox AI] 🗑 CARPETA ELIMINADA:", path .. "/" .. name)
		ChangeHistoryService:SetWaypoint("OmniRoute eliminar carpeta " .. name)
		return true
	end

	return false
end

local function ejecutarExtendedAction(action)
	local tipo = string.lower(tostring(action.type or ""))

	if tipo == "run_studio_test" then
		return ejecutarStudioTest(action)
	end

	local path = tostring(action.path or "")
	local name = tostring(action.name or "")

	if tipo == "create_instance" then
		local className = tostring(action.className or "")
		if className == "" or name == "" then
			return false
		end

		local container = obtenerContenedor(path, true)
		if not container then return false end

		local existing = container:FindFirstChild(name)
		if existing then
			if not claseCoincide(existing, className) then
				warn("[Roblox AI] CREATE_INSTANCE rechazado: nombre ocupado por otra clase.")
				return false
			end
			local total = aplicarPropiedades(existing, action.properties)
			print("[Roblox AI] ℹ INSTANCIA YA EXISTE:", existing:GetFullName(), "propiedades:", total)
			return true
		end

		local ok, created = pcall(function()
			local instance = Instance.new(className)
			instance.Name = name
			instance.Parent = container
			return instance
		end)

		if not ok or not created then
			warn("[Roblox AI] No se pudo crear clase:", className, created)
			return false
		end

		local total = aplicarPropiedades(created, action.properties)
		print("[Roblox AI] ✅ INSTANCIA CREADA:", created:GetFullName(), "(" .. className .. ")", "propiedades:", total)
		ChangeHistoryService:SetWaypoint("OmniRoute crear instancia " .. name)
		return true
	end

	local object = obtenerInstancia(path, name)
	if not object then
		warn("[Roblox AI] Objeto no encontrado:", path .. "/" .. name)
		return false
	end

	if not claseCoincide(object, action.className) then
		warn("[Roblox AI] ClassName no coincide:", object:GetFullName(), object.ClassName, action.className)
		return false
	end

	if tipo == "set_property" then
		local ok = aplicarPropiedad(object, tostring(action.property or ""), action.value)
		if ok then ChangeHistoryService:SetWaypoint("OmniRoute propiedad " .. name) end
		return ok
	end

	if tipo == "set_properties" then
		local total = aplicarPropiedades(object, action.properties)
		if total > 0 then ChangeHistoryService:SetWaypoint("OmniRoute propiedades " .. name) end
		return total > 0
	end

	if tipo == "rename_instance" then
		local newName = tostring(action.newName or "")
		if newName == "" or string.find(newName, "/", 1, true) or string.find(newName, "\\", 1, true) then
			return false
		end

		local parent = object.Parent
		if not parent or parent:FindFirstChild(newName) then
			warn("[Roblox AI] RENOMBRAR rechazado: nombre ocupado.")
			return false
		end

		local oldName = object:GetFullName()
		object.Name = newName
		print("[Roblox AI] ✏ RENOMBRADO:", oldName, "→", object:GetFullName())
		ChangeHistoryService:SetWaypoint("OmniRoute renombrar " .. newName)
		return true
	end

	if tipo == "move_instance" then
		local targetPath = tostring(action.targetPath or "")
		local destination = obtenerContenedor(targetPath, false)
		if not destination then
			warn("[Roblox AI] Destino no encontrado:", targetPath)
			return false
		end

		if destination == object or object:IsDescendantOf(destination) then
			warn("[Roblox AI] MOVE rechazado: destino invalido.")
			return false
		end

		if destination:FindFirstChild(object.Name) then
			warn("[Roblox AI] MOVE rechazado: nombre ocupado en destino.")
			return false
		end

		local oldName = object:GetFullName()
		object.Parent = destination
		print("[Roblox AI] 📦 MOVIDO:", oldName, "→", object:GetFullName())
		ChangeHistoryService:SetWaypoint("OmniRoute mover " .. object.Name)
		return true
	end

	if tipo == "delete_instance" then
		local fullName = object:GetFullName()
		object:Destroy()
		print("[Roblox AI] 🗑 INSTANCIA ELIMINADA:", fullName)
		ChangeHistoryService:SetWaypoint("OmniRoute eliminar " .. name)
		return true
	end

	warn("[Roblox AI] Accion extendida desconocida:", tipo)
	return false
end

function ejecutarStudioTest(action)
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

	if serverCode == "" and clientCode == "" then
		warn("[Roblox AI] run_studio_test sin serverCode/clientCode")
		return false
	end

	local token = string.gsub(testId, "[^%w_]", "_")
	local folderName = "__RobloxAI_Test_" .. token
	local folder = Instance.new("Folder")
	folder.Name = folderName
	folder.Parent = game:GetService("ReplicatedStorage")

	local report = Instance.new("RemoteEvent")
	report.Name = "Report"
	report.Parent = folder

	local serverScript = Instance.new("Script")
	serverScript.Name = folderName .. "_Server"
	serverScript.Source = serverCode
	serverScript.Parent = folder

	local clientScript = Instance.new("LocalScript")
	clientScript.Name = folderName .. "_Client"
	clientScript.Source = clientCode
	clientScript.Parent = game:GetService("StarterPlayer"):WaitForChild("StarterPlayerScripts")

	local inicio = os.clock()
	local okRun, result = pcall(function()
		return StudioTestService:ExecuteMultiplayerTestAsync(numPlayers, duration)
	end)

	local logs = {}
	pcall(function()
		for _, entry in ipairs(LogService:GetLogHistory()) do
			table.insert(logs, {
				message = tostring(entry.message or ""),
				messageType = tostring(entry.messageType or ""),
				timestamp = tonumber(entry.timestamp) or 0
			})
		end
	end)

	local errors = 0
	local warnings = 0
	for _, entry in ipairs(logs) do
		local kind = string.lower(entry.messageType)
		if string.find(kind, "error", 1, true) then
			errors += 1
		elseif string.find(kind, "warning", 1, true) then
			warnings += 1
		end
	end

	local resultData = {
		testId = testId,
		ok = okRun and errors == 0,
		executionOk = okRun,
		result = result,
		duration = os.clock() - inicio,
		numPlayers = numPlayers,
		errorCount = errors,
		warningCount = warnings,
		logs = logs
	}

	pcall(function() folder:Destroy() end)
	pcall(function() clientScript:Destroy() end)
	
	local postOk, postResponse = pcall(function()
		return HttpService:RequestAsync({
			Url = TEST_RESULTS_URL,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["Accept"] = "application/json"
			},
			Body = HttpService:JSONEncode(resultData)
		})
	end)

	if not postOk or not postResponse.Success then
		warn("[Roblox AI] No se pudo enviar resultado de test.")
	end

	if resultData.ok then
		print("[Roblox AI] ✅ TEST OK:", testId)
	else
		warn("[Roblox AI] ❌ TEST FALLÓ:", testId, tostring(result))
	end

	return resultData.ok
end

local function intentarAccionEmpaquetada(action)
	if type(action) ~= "table" or type(action.code) ~= "string" then
		return false
	end

	local marker = "__ROBLOX_AI_EXTENDED_ACTION__"
	if action.type ~= "update_script" or action.code:sub(1, #marker) ~= marker then
		return false
	end

	local json = action.code:sub(#marker + 1):gsub("^%s+", "")
	local ok, extended = pcall(function()
		return HttpService:JSONDecode(json)
	end)

	if ok and type(extended) == "table" then
		ejecutarExtendedAction(extended)
	end

	return true
end

local function ejecutarAccion(action)
	if type(action) ~= "table" then
		return false
	end

	if intentarAccionEmpaquetada(action) then
		return true
	end

	local tipo = string.lower(tostring(action.type or action.action or ""))
	action.type = tipo

	if SCRIPT_TYPES[tipo] then
		return ejecutarScriptAction(action)
	end

	if REMOTE_TYPES[tipo] then
		return ejecutarRemoteAction(action)
	end

	if tipo == "create_folder" or tipo == "delete_folder" then
		return ejecutarCarpeta(action)
	end

	if tipo == "create_instance"
		or tipo == "delete_instance"
		or tipo == "set_property"
		or tipo == "set_properties"
		or tipo == "rename_instance"
		or tipo == "move_instance"
		or tipo == "run_studio_test" then
		return ejecutarExtendedAction(action)
	end

	warn("[Roblox AI] Accion desconocida:", tipo)
	return false
end

local function consultarServidor()
	if consultando or not conectado then
		return
	end

	consultando = true

	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = NEXT_URL,
			Method = "GET"
		})
	end)

	consultando = false

	if not ok or not response.Success then
		return
	end

	local jsonOk, data = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)

	if not jsonOk or type(data) ~= "table" or type(data.actions) ~= "table" then
		return
	end

	if #data.actions == 0 then
		return
	end

	print("[Roblox AI] 📥 Acciones OmniRoute:", #data.actions)
	ChangeHistoryService:SetWaypoint("Antes de cambios OmniRoute")

	local exitosas = 0
	local fallidas = 0

	for _, action in ipairs(data.actions) do
		local okAction, resultado = pcall(function()
			return ejecutarAccion(action)
		end)

		if okAction and resultado then
			exitosas += 1
		else
			fallidas += 1
			if not okAction then
				warn("[Roblox AI] Error ejecutando accion:", resultado)
			end
		end
	end

	print("[Roblox AI] Resultado acciones: " .. exitosas .. " exitosas | " .. fallidas .. " fallidas")
	ChangeHistoryService:SetWaypoint("Cambios OmniRoute completados")

	if exitosas > 0 then
		escanearProyecto()
	end
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
		print("[Roblox AI] 🔌 DESCONECTADO")
		return
	end

	if not comprobarServidor() then
		return
	end

	conectado = true
	button:SetActive(true)

	print("=================================")
	print("[Roblox AI] 🟢 CONECTADO")
	print("[Roblox AI] Proveedor: OmniRoute")
	print("[Roblox AI] Acciones: crear, eliminar, modificar, propiedades, mover, renombrar, pruebas")
	print("[Roblox AI] Escaneo: al conectar + cada 5 minutos")
	print("=================================")

	escanearProyecto()
	iniciarLoops()
end)
