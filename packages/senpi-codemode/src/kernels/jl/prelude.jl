using Base64

function display(value)
    text = senpi_json(value)
    senpi_emit(Dict("type" => "display", "mimeType" => "application/json", "dataBase64" => base64encode(text)))
    return nothing
end

function print(values...)
    senpi_emit(Dict("type" => "text", "stream" => "stdout", "data" => join(string.(values), "")))
    return nothing
end

function read(path::AbstractString)
    return Base.read(path, String)
end

function write(path::AbstractString, content)
    Base.write(path, string(content))
    return path
end

function env(key=nothing, value=nothing)
    if key === nothing
        return Dict(k => v for (k, v) in ENV)
    elseif value === nothing
        return get(ENV, string(key), nothing)
    else
        ENV[string(key)] = string(value)
        return value
    end
end

function log(message)
    senpi_emit(Dict("type" => "log", "message" => string(message)))
    return nothing
end

function phase(title)
    senpi_emit(Dict("type" => "phase", "title" => string(title)))
    return nothing
end

struct SenpiToolProxy end

function Base.getproperty(::SenpiToolProxy, name::Symbol)
    return args -> senpi_call_tool(string(name), args)
end

const tool = SenpiToolProxy()
