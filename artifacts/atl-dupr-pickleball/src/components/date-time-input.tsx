import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface DateTimeInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  "data-testid"?: string;
  required?: boolean;
  className?: string;
}

/**
 * Cross-browser date+time picker.
 *
 * Renders a paired <date> + <time> input instead of a single <datetime-local>
 * so that Safari (which doesn't show the time picker for datetime-local) works
 * correctly. Accepts and emits values in the same "YYYY-MM-DDTHH:mm" format
 * that datetime-local uses.
 */
export function DateTimeInput({
  value,
  onChange,
  id,
  "data-testid": testId,
  required,
  className,
}: DateTimeInputProps) {
  const [datePart, timePart] = value ? value.split("T") : ["", ""];

  function handleDate(e: React.ChangeEvent<HTMLInputElement>) {
    const newDate = e.target.value;
    onChange(newDate ? `${newDate}T${timePart || "00:00"}` : "");
  }

  function handleTime(e: React.ChangeEvent<HTMLInputElement>) {
    const newTime = e.target.value;
    onChange(datePart ? `${datePart}T${newTime || "00:00"}` : "");
  }

  return (
    <div className={cn("flex gap-2", className)}>
      <Input
        id={id}
        data-testid={testId}
        type="date"
        value={datePart ?? ""}
        onChange={handleDate}
        required={required}
        className="flex-1 min-w-0"
      />
      <Input
        type="time"
        value={timePart ?? ""}
        onChange={handleTime}
        required={required}
        className="w-28 shrink-0"
      />
    </div>
  );
}
