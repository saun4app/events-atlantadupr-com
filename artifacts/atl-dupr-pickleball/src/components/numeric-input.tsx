import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";

interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> {
  value: number;
  onChange: (value: number) => void;
}

export function NumericInput({ value, onChange, ...props }: NumericInputProps) {
  const [display, setDisplay] = useState(String(value));
  const lastValidValue = useRef(value);

  useEffect(() => {
    if (value !== lastValidValue.current) {
      lastValidValue.current = value;
      setDisplay(String(value));
    }
  }, [value]);

  return (
    <Input
      type="number"
      value={display}
      onChange={e => {
        const raw = e.target.value;
        setDisplay(raw);
        if (raw !== "") {
          const n = Number(raw);
          if (!isNaN(n)) {
            lastValidValue.current = n;
            onChange(n);
          }
        }
      }}
      onBlur={() => {
        const n = Number(display);
        if (display === "" || isNaN(n)) {
          setDisplay(String(lastValidValue.current));
        }
      }}
      {...props}
    />
  );
}
