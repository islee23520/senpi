require "json"
require_relative "prelude"

$__senpi_binding = TOPLEVEL_BINDING
$__senpi_pending_replies = {}
$__senpi_mutex = Mutex.new
$__senpi_current_cell = nil

def __senpi_emit(frame)
  STDOUT.write(JSON.generate(frame))
  STDOUT.write("\n")
  STDOUT.flush
end

def __senpi_error(error)
  { "name" => error.class.name, "message" => error.message, "stack" => error.backtrace&.join("\n") }
end

def __senpi_call_tool(name, args)
  call_id = "#{Time.now.to_i}-#{rand(1_000_000)}"
  __senpi_emit({ "type" => "tool-call", "callId" => call_id, "toolName" => name, "args" => args })
  loop do
    reply = $__senpi_pending_replies.delete(call_id)
    if reply
      raise reply["error"]["message"].to_s unless reply["ok"]
      return reply["value"]
    end
    line = STDIN.gets
    raise "tool bridge closed before #{name} replied" if line.nil?
    message = JSON.parse(line)
    if message["type"] == "tool-reply"
      $__senpi_pending_replies[message["callId"]] = message
    end
  end
end

def __senpi_run_cell(message)
  started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
  $__senpi_current_cell = message["cellId"]
  begin
    value = eval(message["code"].to_s, $__senpi_binding, "(senpi-rb)")
    frame = {
      "type" => "result",
      "cellId" => message["cellId"],
      "ok" => true,
      "durationMs" => ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round,
    }
    frame["valueRepr"] = JSON.generate(value) unless value.nil?
    __senpi_emit(frame)
  rescue Exception => error
    __senpi_emit({
      "type" => "result",
      "cellId" => message["cellId"],
      "ok" => false,
      "error" => __senpi_error(error),
      "durationMs" => ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round,
    })
  ensure
    $__senpi_current_cell = nil
  end
end

STDIN.each_line do |line|
  message = JSON.parse(line)
  case message["type"]
  when "init"
    __senpi_emit({ "type" => "ready" })
  when "run"
    __senpi_run_cell(message)
  when "tool-reply"
    $__senpi_pending_replies[message["callId"]] = message
  when "close"
    __senpi_emit({ "type" => "closed" })
    exit 0
  end
end
