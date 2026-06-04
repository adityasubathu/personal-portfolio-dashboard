import { useRef, useState } from 'react'
import {
  Alert, Badge, Box, Button, Code, Group, NumberInput,
  Stack, Table, Text, TextInput, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconUpload, IconTrash } from '@tabler/icons-react'
import { useImports, useImportMutation, useRollbackMutation, useSplitCreditMutation } from '../api/trades'
import { useTradedInstruments } from '../api/portfolio'
import type { ImportResponse } from '../types/trades'

function ImportResult({ result }: { result: ImportResponse }) {
  return (
    <Box mt="sm">
      {result.results.map((r) => (
        <Alert
          key={r.batch_id}
          color={r.errors.length ? 'yellow' : 'green'}
          title={r.filename}
          mb="xs"
        >
          <Text size="xs">
            {r.success_count}/{r.row_count} rows imported
            {r.errors.length > 0 && ` · ${r.errors.length} error(s)`}
          </Text>
          {r.errors.map((e, i) => (
            <Text key={i} size="xs" c="red">Row {e.row}: {e.message}</Text>
          ))}
        </Alert>
      ))}
      {result.violations.length > 0 && (
        <Alert color="orange" title="Holding violations" mt="xs">
          {result.violations.map((v, i) => (
            <Text key={i} size="xs">{v.kind}: {v.symbol ?? v.isin} — {v.detail}</Text>
          ))}
        </Alert>
      )}
    </Box>
  )
}

export function Import() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [importResult, setImportResult] = useState<ImportResponse | null>(null)
  const importMut = useImportMutation()
  const rollbackMut = useRollbackMutation()
  const splitMut = useSplitCreditMutation()
  const { data: imports } = useImports()
  const { data: instruments } = useTradedInstruments()

  // Split credit form state
  const [splitInstrId, setSplitInstrId] = useState<number | string>('')
  const [splitDate, setSplitDate] = useState('')
  const [splitQty, setSplitQty] = useState<number | string>('')
  const [splitResult, setSplitResult] = useState<string | null>(null)

  async function handleUpload() {
    const files = fileRef.current?.files
    if (!files?.length) return
    try {
      const r = await importMut.mutateAsync(Array.from(files))
      setImportResult(r)
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    }
  }

  async function handleRollback(batchId: string) {
    try {
      await rollbackMut.mutateAsync(batchId)
      notifications.show({ color: 'green', message: 'Batch rolled back.' })
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    }
  }

  async function handleSplitCredit() {
    if (!splitInstrId || !splitDate || !splitQty) return
    try {
      const r = await splitMut.mutateAsync({
        instrument_id: Number(splitInstrId),
        trade_date: splitDate,
        quantity: Number(splitQty),
      })
      setSplitResult(
        r.violations.length
          ? `Done. ${r.violations.length} violation(s) detected.`
          : 'Split credit recorded.',
      )
    } catch (e) {
      setSplitResult(`Error: ${e}`)
    }
  }

  return (
    <Stack gap="lg" maw={800}>
      <Title order={3}>Import Trades</Title>

      {/* Upload */}
      <Box>
        <Text fw={600} mb="xs">Upload CSV</Text>
        <Group>
          <input ref={fileRef} type="file" accept=".csv" multiple style={{ fontSize: '0.85rem' }} />
          <Button
            size="xs"
            leftSection={<IconUpload size={14} />}
            loading={importMut.isPending}
            onClick={handleUpload}
          >
            Import
          </Button>
        </Group>
        {importResult && <ImportResult result={importResult} />}
      </Box>

      {/* Import history */}
      {imports && imports.length > 0 && (
        <Box>
          <Text fw={600} mb="xs">Import History</Text>
          <Table fz="xs" withColumnBorders={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>File</Table.Th>
                <Table.Th>Imported at</Table.Th>
                <Table.Th>Rows</Table.Th>
                <Table.Th>Errors</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {imports.map((log) => (
                <Table.Tr key={log.batch_id}>
                  <Table.Td>{log.filename ?? '—'}</Table.Td>
                  <Table.Td>{new Date(log.imported_at).toLocaleString('en-IN')}</Table.Td>
                  <Table.Td>{log.row_count ?? '—'}</Table.Td>
                  <Table.Td>
                    {log.error_count ? (
                      <Badge color="red" size="xs">{log.error_count}</Badge>
                    ) : (
                      <Badge color="green" size="xs">0</Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      leftSection={<IconTrash size={12} />}
                      loading={rollbackMut.isPending}
                      onClick={() => handleRollback(log.batch_id)}
                    >
                      Rollback
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      )}

      {/* Split credit */}
      <Box>
        <Text fw={600} mb="xs">Record Split / Bonus Credit</Text>
        <Group align="flex-end" wrap="nowrap">
          <Box style={{ minWidth: 180 }}>
            <Text size="xs" mb={4}>Instrument</Text>
            <select
              value={splitInstrId}
              onChange={(e) => setSplitInstrId(e.target.value)}
              style={{ width: '100%', padding: '6px', fontSize: '0.85rem', background: 'var(--mantine-color-gray-1)', color: 'inherit', border: '1px solid var(--mantine-color-gray-3)', borderRadius: 4 }}
            >
              <option value="">— select —</option>
              {instruments?.map((i) => (
                <option key={i.id} value={i.id}>{i.symbol} {i.isin ? `(${i.isin})` : ''}</option>
              ))}
            </select>
          </Box>
          <TextInput
            label="Date"
            type="date"
            value={splitDate}
            onChange={(e) => setSplitDate(e.currentTarget.value)}
            size="xs"
            w={140}
          />
          <NumberInput
            label="Quantity"
            value={splitQty}
            onChange={setSplitQty}
            min={0}
            size="xs"
            w={120}
          />
          <Button
            size="xs"
            loading={splitMut.isPending}
            onClick={handleSplitCredit}
          >
            Record
          </Button>
        </Group>
        {splitResult && (
          <Text size="xs" mt="xs" c="dimmed">{splitResult}</Text>
        )}
      </Box>
    </Stack>
  )
}
