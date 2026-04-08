"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Evidence } from "@/types";

export default function EvidencesPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const [evidences, setEvidences] = useState<Evidence[]>([]);

  async function loadEvidences() {
    const res = await fetch("/api/evidences");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) setEvidences(data);
    }
  }

  useEffect(() => {
    loadEvidences();
  }, []);

  async function handleDelete(id: string) {
    if (!confirm("Delete this evidence?")) return;
    const res = await fetch(`/api/evidences?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Evidence deleted");
      loadEvidences();
    } else {
      toast.error("Failed to delete");
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">
          {isAdmin ? "All Evidence" : "My Evidence"}
        </h1>
        <p className="text-muted-foreground">
          {isAdmin
            ? "View all uploaded evidence files"
            : "Evidence files you have uploaded"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Evidence Files ({evidences.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {evidences.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No evidence files yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File Name</TableHead>
                  <TableHead>Uploaded By</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {evidences.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell className="font-medium">{ev.fileName}</TableCell>
                    <TableCell>{ev.uploaderName}</TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {ev.description || "-"}
                    </TableCell>
                    <TableCell>
                      {new Date(ev.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <a
                          href={ev.driveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button variant="ghost" size="sm">
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                        </a>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(ev.id)}
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
