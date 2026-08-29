"use client"

import { useRef, useState } from "react"
import { ImageIcon, LinkIcon, Upload, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface ImageUploadProps {
  value: string
  onChange: (url: string) => void
  label?: string
}

type Mode = "upload" | "url"

export function ImageUpload({ value, onChange, label = "Image" }: ImageUploadProps) {
  const [mode, setMode] = useState<Mode>(value && !value.startsWith("/") ? "url" : "upload")
  const [uploading, setUploading] = useState(false)
  const [urlInput, setUrlInput] = useState(value && !value.startsWith("/") ? value : "")
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    const form = new FormData()
    form.append("file", file)

    const res = await fetch("/api/upload", { method: "POST", body: form })
    setUploading(false)

    if (!res.ok) {
      const json = await res.json()
      toast.error(json.error ?? "Upload failed")
      return
    }
    const { url } = await res.json()
    onChange(url)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleUrlBlur() {
    if (urlInput.trim()) onChange(urlInput.trim())
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      {/* Mode toggle */}
      <div className="flex rounded-lg border overflow-hidden w-fit text-sm">
        {(["upload", "url"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 transition-colors",
              mode === m
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {m === "upload" ? <Upload className="h-3.5 w-3.5" /> : <LinkIcon className="h-3.5 w-3.5" />}
            {m === "upload" ? "Upload file" : "Image URL"}
          </button>
        ))}
      </div>

      {mode === "upload" ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
            "hover:border-primary hover:bg-primary/5",
            uploading && "opacity-60 pointer-events-none"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />
          <ImageIcon className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm font-medium">
            {uploading ? "Uploading…" : "Click or drag & drop"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WebP, GIF · max 5MB</p>
        </div>
      ) : (
        <Input
          type="url"
          placeholder="https://example.com/image.jpg"
          value={urlInput}
          onChange={(e) => {
            setUrlInput(e.target.value)
            // call parent immediately so submit always has latest value
            if (e.target.value.trim()) onChange(e.target.value.trim())
          }}
          onBlur={handleUrlBlur}
          onKeyDown={(e) => e.key === "Enter" && handleUrlBlur()}
        />
      )}

      {/* Preview + clear */}
      {value && (
        <div className="relative w-32 h-32 rounded-lg overflow-hidden border group">
          <img src={value} alt="Preview" className="w-full h-full object-cover" />
          <button
            type="button"
            onClick={() => { onChange(""); setUrlInput("") }}
            className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
          >
            <X className="h-5 w-5 text-white" />
          </button>
        </div>
      )}
    </div>
  )
}
