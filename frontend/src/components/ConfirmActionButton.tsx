import { useState, type ReactNode } from 'react'
import { Button, Group, Modal, Text, type ButtonProps } from '@mantine/core'
interface ConfirmActionButtonProps extends Omit<ButtonProps, 'onClick'> { confirmTitle: string; confirmDescription: ReactNode; onConfirm: () => Promise<unknown> | unknown; confirmLabel?: string; children: ReactNode }
export function ConfirmActionButton({ confirmTitle, confirmDescription, onConfirm, confirmLabel = 'Confirm', children, color, ...props }: ConfirmActionButtonProps) {
  const [opened, setOpened] = useState(false); const [pending, setPending] = useState(false)
  async function confirm() { setPending(true); try { await onConfirm(); setOpened(false) } catch { /* callers retain notification handling */ } finally { setPending(false) } }
  return <><Button {...props} color={color} onClick={() => setOpened(true)}>{children}</Button><Modal opened={opened} onClose={() => !pending && setOpened(false)} title={confirmTitle} centered returnFocus size="sm"><Text size="sm">{confirmDescription}</Text><Group justify="flex-end" mt="md"><Button variant="default" onClick={() => setOpened(false)} disabled={pending}>Cancel</Button><Button color={color} onClick={confirm} loading={pending} disabled={pending}>{confirmLabel}</Button></Group></Modal></>
}
