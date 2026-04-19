import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { cn } from "#/lib/utils"
import { Calendar } from "#/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover"

export interface DatePickerProps {
  value: Date | undefined
  onChange: (value: Date | undefined) => void
  placeholder?: string
  className?: string
  triggerClassName?: string
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  className,
  triggerClassName,
}: DatePickerProps) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "border-border bg-background hover:bg-muted aria-expanded:bg-muted inline-flex h-9 w-full items-center gap-1.5 rounded-md border px-2.5 text-sm font-normal shadow-xs outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          triggerClassName
        )}
      >
        <CalendarIcon className="size-4" />
        <span className={value ? undefined : "text-muted-foreground"}>
          {value ? format(value, "MMM d, yyyy") : placeholder}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("w-auto p-0", className)}>
        <Calendar mode="single" selected={value} onSelect={onChange} />
      </PopoverContent>
    </Popover>
  )
}
