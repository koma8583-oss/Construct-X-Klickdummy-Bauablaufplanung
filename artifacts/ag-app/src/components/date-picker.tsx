import * as React from 'react';
import { format, isValid, parse } from 'date-fns';
import { Calendar as CalendarIcon, Clock3, X } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type DatePickerProps = {
  value?: string;
  defaultValue?: string;
  onChange: (value: string) => void;
  includeTime?: boolean;
  name?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
};

const DATE_FORMAT = 'yyyy-MM-dd';
const DATETIME_FORMAT = "yyyy-MM-dd'T'HH:mm";

function parseValue(value: string | undefined, includeTime: boolean): Date | undefined {
  if (!value) return undefined;
  const parsed = parse(value, includeTime ? DATETIME_FORMAT : DATE_FORMAT, new Date());
  return isValid(parsed) ? parsed : undefined;
}

export function DatePicker({
  value,
  defaultValue = '',
  onChange,
  includeTime = false,
  name,
  id,
  required,
  disabled,
  min,
  max,
  placeholder = includeTime ? 'Datum und Uhrzeit auswählen' : 'Datum auswählen',
  className,
  'aria-label': ariaLabel,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const currentValue = value ?? internalValue;
  const selected = parseValue(currentValue, includeTime);
  const minDate = parseValue(min, includeTime);
  const maxDate = parseValue(max, includeTime);

  const updateDate = (date: Date | undefined) => {
    if (!date) return;
    const nextValue = format(date, includeTime ? DATETIME_FORMAT : DATE_FORMAT);
    setInternalValue(nextValue);
    onChange(nextValue);
    if (!includeTime) setOpen(false);
  };

  const updateTime = (time: string) => {
    if (!time) return;
    const date = selected ?? new Date();
    const [hours, minutes] = time.split(':').map(Number);
    date.setHours(hours, minutes, 0, 0);
    const nextValue = format(date, DATETIME_FORMAT);
    setInternalValue(nextValue);
    onChange(nextValue);
  };

  return (
    <div className="relative">
      {name && <input type="hidden" name={name} value={currentValue} />}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={ariaLabel}
            aria-haspopup="dialog"
            className={cn(
              'w-full justify-start text-left font-normal',
              !currentValue && 'text-muted-foreground',
              className,
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
            <span className="truncate">
              {selected
                ? format(selected, includeTime ? 'dd.MM.yyyy HH:mm' : 'dd.MM.yyyy')
                : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={updateDate}
            disabled={[
              ...(minDate ? [{ before: minDate }] : []),
              ...(maxDate ? [{ after: maxDate }] : []),
            ]}
            initialFocus
          />
          {includeTime && (
            <div className="border-t p-3">
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                Uhrzeit
                <input
                  type="time"
                  value={selected ? format(selected, 'HH:mm') : ''}
                  onChange={(event) => updateTime(event.target.value)}
                  className="ml-auto h-8 rounded-md border bg-background px-2 text-sm text-foreground"
                />
              </label>
            </div>
          )}
          {currentValue && !required && (
            <div className="border-t p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-center text-xs"
                onClick={() => {
                  setInternalValue('');
                  onChange('');
                  setOpen(false);
                }}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Datum entfernen
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          value={currentValue}
          onChange={() => undefined}
          className="pointer-events-none absolute h-px w-px opacity-0"
        />
      )}
    </div>
  );
}