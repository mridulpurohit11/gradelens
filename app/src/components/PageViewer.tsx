import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { apiBlob } from '@/lib/api';
import { openExternal } from '@/lib/platform';
import { Button, Icon, IconButton, Skeleton } from '@/components/ui';

export function usePageImage(submissionId: string, page: number, enabled = true) {
  const q = useQuery({
    queryKey: ['page', submissionId, page],
    queryFn: async () => URL.createObjectURL((await apiBlob(`/submissions/${submissionId}/pages/${page}`)).blob),
    enabled,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: 1,
  });
  return q;
}

/** Zoomable viewer for the processed page images of a submission. */
export function PageViewer({
  submissionId,
  pageCount,
  files,
  className,
  compact,
}: {
  submissionId: string;
  pageCount: number;
  files?: { name: string; driveUrl: string | null }[];
  className?: string;
  compact?: boolean;
}) {
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const img = usePageImage(submissionId, page, pageCount > 0);
  usePageImage(submissionId, page + 1, pageCount > page + 1); // prefetch next page

  useEffect(() => setZoom(1), [page]);

  const driveUrl = files?.find((f) => f.driveUrl)?.driveUrl;

  return (
    <div className={clsx('card overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-1">
          <IconButton icon="remove" label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} className="h-9 w-9" />
          <span className="tnum w-12 text-center text-small font-semibold text-ink">{Math.round(zoom * 100)}%</span>
          <IconButton icon="add" label="Zoom in" onClick={() => setZoom((z) => Math.min(3, z + 0.5))} disabled={zoom >= 3} className="h-9 w-9" />
          {zoom !== 1 ? (
            <Button variant="ghost" size="sm" icon="fit_width" onClick={() => setZoom(1)} className="hidden sm:inline-flex">
              Fit
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <IconButton icon="chevron_left" label="Previous page" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="h-9 w-9" />
          <span className="tnum whitespace-nowrap rounded-full bg-primary-tint px-2.5 py-0.5 text-caption font-semibold text-primary">
            Page {pageCount ? page + 1 : 0} of {pageCount}
          </span>
          <IconButton icon="chevron_right" label="Next page" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} className="h-9 w-9" />
        </div>
      </div>
      <div className={clsx('overflow-auto bg-subtle', compact ? 'max-h-[60vh]' : 'max-h-[70vh] lg:max-h-[calc(100dvh-220px)]')}>
        {pageCount === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-small text-muted">
            <Icon name="description" size={32} />
            Typed submission — no page images.
          </div>
        ) : img.isLoading ? (
          <Skeleton className="m-4 aspect-[3/4] rounded-ctl" />
        ) : img.error ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 px-6 text-center text-small text-muted">
            <Icon name="broken_image" size={32} />
            {img.error instanceof Error ? img.error.message : 'Page could not be loaded.'}
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => void img.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <img src={img.data} alt={`Page ${page + 1}`} className="mx-auto block max-w-none select-none" style={{ width: `${zoom * 100}%` }} draggable={false} />
        )}
      </div>
      {driveUrl ? (
        <div className="border-t border-line px-3 py-2 text-right">
          <button type="button" onClick={() => void openExternal(driveUrl)} className="inline-flex items-center gap-1 text-small font-semibold text-primary hover:underline">
            Open original in Drive <Icon name="open_in_new" size={16} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
