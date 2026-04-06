import { useEffect, useRef, useState } from 'react';

interface DocumentRecord {
  id: string;
  filename: string;
  mimeType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const ACCEPTED_MIME: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
};

export default function DocumentVault() {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function fetchDocs() {
    setLoadingList(true);
    fetch('/api/documents')
      .then((r) => r.json() as Promise<{ ok: boolean; data: DocumentRecord[] }>)
      .then((json) => { if (json.ok) setDocs(json.data); })
      .catch(() => { /* server may not be up */ })
      .finally(() => setLoadingList(false));
  }

  useEffect(() => { fetchDocs(); }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_MIME[file.type]) {
      setUploadError('Only PDF and DOCX files are supported.');
      return;
    }

    setUploadError(null);
    setUploadSuccess(null);
    setUploading(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      if (!base64) {
        setUploadError('Failed to read file.');
        setUploading(false);
        return;
      }
      try {
        const res = await fetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            mimeType: file.type,
            content: base64,
          }),
        });
        const json = await res.json() as {
          ok: boolean;
          data?: { id: string; filename: string };
          error?: { message: string };
        };
        if (json.ok && json.data) {
          setUploadSuccess(`"${json.data.filename}" uploaded successfully.`);
          fetchDocs();
        } else {
          setUploadError(json.error?.message ?? 'Upload failed.');
        }
      } catch {
        setUploadError('Server unreachable.');
      } finally {
        setUploading(false);
        // Reset file input so the same file can be re-uploaded if needed
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.onerror = () => {
      setUploadError('Failed to read file.');
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3.5 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-100">Document Vault</h2>
      </div>

      {/* Upload area */}
      <div className="px-5 py-4 border-b border-zinc-800 space-y-3">
        <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-widest">Upload a document</label>
        <div className="flex items-center gap-3">
          <label
            className={`cursor-pointer inline-flex items-center gap-2 rounded-xl border border-dashed border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-400 hover:border-indigo-500/50 hover:text-zinc-200 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleFileChange}
              disabled={uploading}
              className="sr-only"
            />
            {uploading ? 'Uploading…' : 'Choose file (PDF or DOCX)'}
          </label>
        </div>

        {uploadError && (
          <p className="text-xs text-red-400">{uploadError}</p>
        )}
        {uploadSuccess && (
          <p className="text-xs text-emerald-400">{uploadSuccess}</p>
        )}
      </div>

      {/* Document list */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
        {loadingList && <p className="text-sm text-zinc-500">Loading…</p>}
        {!loadingList && docs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm text-zinc-400 font-medium">No documents yet</p>
            <p className="text-xs text-zinc-600 mt-1">Upload a PDF or DOCX to get started.</p>
          </div>
        )}

        {docs.map((doc) => {
          const typeLabel = ACCEPTED_MIME[doc.mimeType] ?? doc.mimeType;
          const pages = typeof doc.metadata?.pages === 'number' ? doc.metadata.pages : null;
          return (
            <div key={doc.id} className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 flex items-start gap-3 card-hover">
              <div
                className={`shrink-0 mt-0.5 text-xs font-bold px-1.5 py-0.5 rounded-md ${
                  typeLabel === 'PDF'
                    ? 'bg-red-500/10 text-red-400'
                    : 'bg-indigo-500/10 text-indigo-400'
                }`}
              >
                {typeLabel}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-200 truncate">{doc.filename}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {new Date(doc.createdAt).toLocaleDateString()}
                  {pages !== null && ` · ${pages} page${pages !== 1 ? 's' : ''}`}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
