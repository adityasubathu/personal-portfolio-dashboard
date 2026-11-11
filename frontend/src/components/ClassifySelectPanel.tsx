import { useState } from 'react'
import { Check, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { notify } from '@/lib/notify'

/** Shared shell for the two "pick a value for each unclassified name" panels.
 *  onSave returns how many holdings the server updated. */
export function ClassifySelectPanel({
  title,
  columnLabel,
  columnWidth,
  placeholder,
  options,
  searchable = false,
  names,
  saving,
  onSave,
  onSaved,
  onDone,
}: {
  title: (count: number) => string
  columnLabel: string
  columnWidth: number
  placeholder: string
  options: string[]
  searchable?: boolean
  names: string[]
  saving: boolean
  onSave: (selections: Record<string, string>) => Promise<number>
  onSaved?: () => void
  onDone: () => void
}) {
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [open, setOpen] = useState(true)

  async function handleSave() {
    const picked = Object.fromEntries(names.filter((n) => selections[n]).map((n) => [n, selections[n]]))
    if (!Object.keys(picked).length) return
    try {
      const updated = await onSave(picked)
      notify.success(`Classified ${updated} holding${updated === 1 ? '' : 's'}.`)
      if (onSaved) onSaved()
      else onDone()
    } catch (e) {
      notify.error(String(e))
    }
  }

  const doneCount = names.filter((n) => selections[n]).length

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="text-sm font-medium">{title(names.length)}</span>
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="h-8 px-2 text-left font-medium text-muted-foreground">Stock name</th>
                <th className="h-8 px-2 text-left font-medium text-muted-foreground" style={{ width: columnWidth }}>{columnLabel}</th>
              </tr>
            </thead>
            <tbody>
              {names.map((n) => (
                <tr key={n}>
                  <td className="px-2 py-1.5">{n}</td>
                  <td className="px-2 py-1.5">
                    {searchable ? (
                      <ClassifyCombobox
                        placeholder={placeholder}
                        options={options}
                        value={selections[n] ?? ''}
                        onChange={(v) => setSelections((prev) => ({ ...prev, [n]: v }))}
                      />
                    ) : (
                      <Select value={selections[n] ?? ''} onValueChange={(v) => setSelections((prev) => ({ ...prev, [n]: v }))}>
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue placeholder={placeholder} />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button size="xs" disabled={saving || !doneCount} onClick={handleSave}>
            Save{doneCount < names.length ? ` (${doneCount} of ${names.length})` : ' all'}
          </Button>
          <Button size="xs" variant="ghost" onClick={onDone}>
            Dismiss
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ClassifyCombobox({
  placeholder,
  options,
  value,
  onChange,
}: {
  placeholder: string
  options: string[]
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          {value || placeholder}
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o} value={o} onSelect={() => { onChange(o); setOpen(false) }}>
                  <Check className={cn('size-3.5', value === o ? 'opacity-100' : 'opacity-0')} />
                  {o}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
