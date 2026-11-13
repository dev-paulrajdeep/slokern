import type { UICandidate } from './adapters/viewModel';

/**
 * Builds the canonical vLLM CLI launch command for a candidate configuration.
 * Handles null/undefined candidates safely with standard workstation defaults.
 */
export function buildVllmLaunchCommand(
  candidate?: UICandidate | null,
  modelName: string = 'meta-llama/Meta-Llama-3-8B-Instruct'
): string {
  const concurrency = candidate?.concurrency ?? 32;
  const batchedTokens = candidate?.batch != null ? candidate.batch * 512 : 2048;
  const blockSize = 16;
  const kvCacheDtype = (candidate?.kvCache || 'AUTO').toLowerCase();

  return `vllm serve ${modelName} \\
  --max-num-seqs ${concurrency} \\
  --max-num-batched-tokens ${batchedTokens} \\
  --block-size ${blockSize} \\
  --kv-cache-dtype ${kvCacheDtype} \\
  --port 8000`;
}

/**
 * Builds single-line vLLM flags for clipboard or inline shell scripts.
 */
export function buildVllmLaunchFlags(
  candidate?: UICandidate | null,
  modelName: string = 'meta-llama/Meta-Llama-3-8B-Instruct'
): string {
  const concurrency = candidate?.concurrency ?? 32;
  const batchedTokens = candidate?.batch != null ? candidate.batch * 512 : 2048;
  const blockSize = 16;
  const kvCacheDtype = (candidate?.kvCache || 'AUTO').toLowerCase();

  return `vllm serve ${modelName} --max-num-seqs ${concurrency} --max-num-batched-tokens ${batchedTokens} --block-size ${blockSize} --kv-cache-dtype ${kvCacheDtype} --port 8000`;
}
