import { useState } from "react";
import { format, parse, isValid } from "date-fns";
import { CalendarIcon, Clock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
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
 * Stacked layout: full-width calendar-popup button on top, time input below.
 * Works on all browsers including Safari.
 * Accepts and emits "YYYY-MM-DDTHH:mm" — same format as datetime-local.
 */
export function DateTimeInput({
  value,
  onChange,
  id,
  "data-testid": testId,
  required,
  className,
}: DateTimeInputProps) {
  const [open, setOpen] = useState(false);

  const [datePart, timePart] = value ? value.split("T") : ["", ""];

  const selectedDate = datePart
    ? parse(datePart, "yyyy-MM-dd", new Date())
    : undefined;
  const validDate = selectedDate && isValid(selectedDate) ? selectedDate : undefined;

  function handleDaySelect(day: Date | undefined) {
    if (!day) return;
    const newDate = format(day, "yyyy-MM-dd");
    onChange(`${newDate}T${timePart || "00:00"}`);
    setOpen(false);
  }

  function handleTime(e: React.ChangeEvent<HTMLInputElement>) {
    const newTime = e.target.value;
    onChange(datePart ? `${datePart}T${newTime || "00:00"}` : "");
  }

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            data-testid={testId}
            type="button"
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              !validDate && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
            {validDate ? format(validDate, "EEE, MMM d, yyyy") : <span>Pick a date</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={validDate}
            onSelect={handleDaySelect}
            initialFocus
          />
        </PopoverContent>
      </Popover>

      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          type="time"
          value={timePart ?? ""}
          onChange={handleTime}
          required={required}
          className="w-32"
        />
      </div>
    </div>
  );
}
