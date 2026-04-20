import { getJob, type BackgroundJob } from '../../../api/job';

export async function waitForJobCompletion(
  jobId: string,
  onUpdate?: (job: BackgroundJob) => void,
  timeoutMs = 900_000,
): Promise<BackgroundJob> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const job = await getJob(jobId);
    if (job) {
      onUpdate?.(job);
      if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
        return job;
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 800));
  }

  throw new Error('等待任务完成超时');
}
