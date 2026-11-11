import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileSearch } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { PageShell } from '@/components/PageShell'
import { Section } from '@/components/Section'
import { EmptyState } from '@/components/EmptyState'
import { JobPanel } from '@/components/JobPanel'
import { IngestResult } from '@/components/IngestResult'
import { ClassifySelectPanel } from '@/components/ClassifySelectPanel'
import { useJob, useJobs, useMarkReadWhenFinished } from '@/api/jobs'
import { useClassifyBatchMutation, useUnclassifiedEquities } from '@/api/mfBreakdown'
import type { IngestDonePayload } from '@/types/mfBreakdown'

const CAP_CATEGORIES = ['Large Cap', 'Mid Cap', 'Small Cap', 'Equity - Foreign']

export function Disclosures() {
  const { jobId } = useParams()
  const { data: jobs } = useJobs()
  const latestId = jobs?.find((j) => j.kind === 'mf_disclosures')?.id ?? null
  const { data: job, isError } = useJob(jobId ? Number(jobId) : latestId)
  const { data: unclassified = [] } = useUnclassifiedEquities()
  const classifyMut = useClassifyBatchMutation()
  const [classifyDismissed, setClassifyDismissed] = useState(false)
  useMarkReadWhenFinished(job)

  return (
    <PageShell width="narrow">
      <PageHeader
        title="Disclosures"
        description="AMFI market-cap list, OpenFin fund disclosures and NSE industry classification — run from Disclosures in the header."
      />

      {unclassified.length > 0 && !classifyDismissed && (
        <ClassifySelectPanel
          title={(n) => `Tag unknown market-cap stocks (${n})`}
          columnLabel="Market cap"
          columnWidth={160}
          placeholder="Select…"
          options={CAP_CATEGORIES}
          names={unclassified}
          saving={classifyMut.isPending}
          onSave={async (selections) =>
            (await classifyMut.mutateAsync(Object.entries(selections).map(([name, category]) => ({ name, category })))).updated
          }
          onSaved={() => {}}
          onDone={() => setClassifyDismissed(true)}
        />
      )}

      {job ? (
        <Section title={jobId ? `Run #${job.id}` : 'Latest run'} description={job.summary ?? undefined}>
          <JobPanel job={job}>
            <IngestResult result={job.result as IngestDonePayload} />
          </JobPanel>
        </Section>
      ) : (
        <EmptyState
          icon={<FileSearch className="size-5" />}
          title={isError ? 'This run no longer exists' : 'No disclosure sync yet'}
          description="Click Disclosures in the header to fetch the latest fund portfolios."
        />
      )}
    </PageShell>
  )
}
