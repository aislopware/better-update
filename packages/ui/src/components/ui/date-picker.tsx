"use client"

import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { Button } from "#/components/ui/button"
import { Calendar } from "#/components/ui/calendar"
import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "#/components/ui/popover"
import { cn } from "#/lib/utils"

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
        render={
          <Button
            className={cn("w-full justify-start", triggerClassName)}
            variant="outline"
          />
        }
      >
        <CalendarIcon aria-hidden="true" />
        {value ? (
          format(value, "PPP")
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </PopoverTrigger>
      <PopoverPopup align="start" className={cn("w-auto p-0", className)}>
        <Calendar
          mode="single"
          onSelect={onChange}
          selected={value}
          {...(value ? { defaultMonth: value } : {})}
        />
      </PopoverPopup>
    </Popover>
  )
}
