"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { FileUp, Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { formatBytes } from "@/lib/bytes"
import { Button } from "@/components/ui/button"

type ProductFile = {
  id: string
  name: string
  sizeBytes: number
  mimeType: string | null
}

/**
 * Manages the files a digital product delivers.
 *
 * Uploads go to private storage, never `public/` — buyers reach them only
 * through a tokenised download link tied to a paid order.
 */
export function ProductFiles({ productId }: { productId: string }) {
  const [files, setFiles] = useState<ProductFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/files`)
      if (res.ok) setFiles(await res.json())
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    void load()
  }, [load])

  async function upload(file: File) {
    setUploading(true)
    try {
      const body = new FormData()
      body.append("file", file)
      const res = await fetch(`/api/products/${productId}/files`, { method: "POST", body })
      const json = await res.json().catch(() => null)

      if (!res.ok) {
        toast.error(json?.error ?? "Upload failed")
        return
      }
      setFiles((current) => [...current, json])
      toast.success(`${file.name} uploaded`)
    } catch {
      toast.error("Upload failed — please try again")
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function remove(fileId: string, name: string) {
    const previous = files
    // Optimistic: the row disappears immediately and comes back on failure.
    setFiles((current) => current.filter((f) => f.id !== fileId))

    const res = await fetch(`/api/products/${productId}/files?fileId=${fileId}`, { method: "DELETE" })
    if (!res.ok) {
      setFiles(previous)
      toast.error(`Could not remove ${name}`)
      return
    }
    toast.success(`${name} removed`)
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading files…
        </div>
      ) : files.length === 0 ? (
        <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
          No files yet. Buyers will have nothing to download.
        </p>
      ) : (
        <ul className="space-y-2">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(file.sizeBytes)}</p>
              </div>
              <button
                type="button"
                onClick={() => remove(file.id, file.name)}
                className="shrink-0 text-muted-foreground hover:text-red-600"
                aria-label={`Remove ${file.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void upload(file)
        }}
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <FileUp className="mr-1.5 h-3.5 w-3.5" />
        )}
        {uploading ? "Uploading…" : "Add file"}
      </Button>

      <p className="text-xs text-muted-foreground">
        Files are stored privately and delivered through expiring links after payment. Up to 200MB
        each.
      </p>
    </div>
  )
}
