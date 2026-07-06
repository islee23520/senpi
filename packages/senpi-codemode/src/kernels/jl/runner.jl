include("prelude.jl")

const senpi_pending_replies = Dict{String, Any}()

function senpi_escape(text::AbstractString)
    out = IOBuffer()
    for c in text
        if c == '"'
            write(out, "\\\"")
        elseif c == '\\'
            write(out, "\\\\")
        elseif c == '\n'
            write(out, "\\n")
        elseif c == '\r'
            write(out, "\\r")
        elseif c == '\t'
            write(out, "\\t")
        else
            write(out, c)
        end
    end
    return String(take!(out))
end

function senpi_json(value)
    if value === nothing
        return "null"
    elseif value isa Bool
        return value ? "true" : "false"
    elseif value isa Number
        return string(value)
    elseif value isa AbstractString
        return "\"" * senpi_escape(value) * "\""
    elseif value isa AbstractDict
        pairs = ["\"" * senpi_escape(string(k)) * "\":" * senpi_json(v) for (k, v) in value]
        return "{" * join(pairs, ",") * "}"
    elseif value isa AbstractVector || value isa Tuple
        return "[" * join([senpi_json(v) for v in value], ",") * "]"
    else
        return "\"" * senpi_escape(string(value)) * "\""
    end
end

function senpi_parse_string(line::String, field::String)
    m = match(Regex("\"" * field * "\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\""), line)
    m === nothing && return nothing
    return replace(m.captures[1], "\\n" => "\n", "\\\"" => "\"", "\\\\" => "\\")
end

function senpi_parse_bool(line::String, field::String)
    m = match(Regex("\"" * field * "\"\\s*:\\s*(true|false)"), line)
    m === nothing && return nothing
    return m.captures[1] == "true"
end

function senpi_emit(frame)
    println(senpi_json(frame))
    flush(stdout)
end

function senpi_call_tool(name::String, args)
    call_id = string(time_ns())
    senpi_emit(Dict("type" => "tool-call", "callId" => call_id, "toolName" => name, "args" => args))
    while true
        if haskey(senpi_pending_replies, call_id)
            reply = pop!(senpi_pending_replies, call_id)
            if reply["ok"]
                return reply["value"]
            end
            error(reply["error"])
        end
        line = readline(stdin)
        type = senpi_parse_string(line, "type")
        if type == "tool-reply"
            senpi_pending_replies[senpi_parse_string(line, "callId")] = Dict(
                "ok" => senpi_parse_bool(line, "ok"),
                "value" => senpi_parse_string(line, "value"),
                "error" => senpi_parse_string(line, "message"),
            )
        end
    end
end

while !eof(stdin)
    line = readline(stdin)
    type = senpi_parse_string(line, "type")
    if type == "init"
        senpi_emit(Dict("type" => "ready"))
    elseif type == "run"
        cell_id = senpi_parse_string(line, "cellId")
        code = senpi_parse_string(line, "code")
        started = time()
        try
            value = Core.eval(Main, Meta.parse(code))
            frame = Dict("type" => "result", "cellId" => cell_id, "ok" => true, "durationMs" => round(Int, (time() - started) * 1000))
            if value !== nothing
                frame["valueRepr"] = senpi_json(value)
            end
            senpi_emit(frame)
        catch err
            senpi_emit(Dict("type" => "result", "cellId" => cell_id, "ok" => false, "error" => Dict("message" => string(err)), "durationMs" => round(Int, (time() - started) * 1000)))
        end
    elseif type == "tool-reply"
        senpi_pending_replies[senpi_parse_string(line, "callId")] = Dict(
            "ok" => senpi_parse_bool(line, "ok"),
            "value" => senpi_parse_string(line, "value"),
            "error" => senpi_parse_string(line, "message"),
        )
    elseif type == "close"
        senpi_emit(Dict("type" => "closed"))
        exit(0)
    end
end
