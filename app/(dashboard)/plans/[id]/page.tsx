"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Upload, UserPlus, ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Plan, Evidence, User } from "@/types";

export default function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";

  const [plan, setPlan] = useState<Plan | null>(null);
  const [evidences, setEvidences] = useState<Evidence[]>([]);
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [allReporters, setAllReporters] = useState<User[]>([]);
  const [uploading, setUploading] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const loadPlan = useCallback(async () => {
    const res = await fetch(`/api/plans/${id}`);
    if (res.ok) {
      const data = await res.json();
      setPlan(data.plan);
      setEvidences(data.evidences);
      setAssignedUserIds(data.assignedUsers);
    }
  }, [id]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  useEffect(() => {
    if (isAdmin) {
      fetch("/api/users")
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) setAllReporters(data);
        });
    }
  }, [isAdmin]);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUploading(true);

    const formData = new FormData(e.currentTarget);
    formData.set("planId", id);

    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    setUploading(false);

    if (res.ok) {
      toast.success("Evidence uploaded successfully");
      (e.target as HTMLFormElement).reset();
      loadPlan();
    } else {
      const data = await res.json();
      toast.error(data.error || "Upload failed");
    }
  }

  async function handleAssign(userId: string) {
    const res = await fetch(`/api/plans/${id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });

    if (res.ok) {
      toast.success("User assigned");
      setAssignOpen(false);
      loadPlan();
    } else {
      const data = await res.json();
      toast.error(data.error || "Failed to assign");
    }
  }

  async function handleUnassign(userId: string) {
    const res = await fetch(`/api/plans/${id}/assign`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });

    if (res.ok) {
      toast.success("User unassigned");
      loadPlan();
    } else {
      toast.error("Failed to unassign");
    }
  }

  async function handleDeleteEvidence(evidenceId: string) {
    if (!confirm("Delete this evidence?")) return;
    const res = await fetch(`/api/evidences?id=${evidenceId}`, {
      method: "DELETE",
    });

    if (res.ok) {
      toast.success("Evidence deleted");
      loadPlan();
    } else {
      toast.error("Failed to delete");
    }
  }

  if (!plan) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  const unassignedReporters = allReporters.filter(
    (r) => !assignedUserIds.includes(r.id)
  );

  return (
    <div className="space-y-6">
      {/* Plan Header */}
      <div>
        <h1 className="text-2xl font-bold">{plan.title}</h1>
        <p className="text-muted-foreground mt-1">
          {plan.description || "No description"}
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Created {new Date(plan.createdAt).toLocaleDateString()}
        </p>
      </div>

      {/* Assigned Users (Admin only) */}
      {isAdmin && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Assigned Reporters</CardTitle>
            <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
              <DialogTrigger render={<Button size="sm" variant="outline" />}>
                <UserPlus className="w-4 h-4 mr-2" />
                Assign
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Assign Reporter</DialogTitle>
                </DialogHeader>
                <div className="space-y-2 mt-4">
                  {unassignedReporters.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      All reporters are already assigned.
                    </p>
                  ) : (
                    unassignedReporters.map((reporter) => (
                      <div
                        key={reporter.id}
                        className="flex items-center justify-between p-3 rounded-lg border"
                      >
                        <div>
                          <p className="text-sm font-medium">{reporter.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {reporter.email}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleAssign(reporter.id)}
                        >
                          Assign
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {assignedUserIds.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No reporters assigned yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {assignedUserIds.map((uid) => {
                  const reporter = allReporters.find((r) => r.id === uid);
                  return (
                    <Badge
                      key={uid}
                      variant="secondary"
                      className="flex items-center gap-1"
                    >
                      {reporter?.name || uid}
                      <button
                        onClick={() => handleUnassign(uid)}
                        className="ml-1 text-muted-foreground hover:text-red-500"
                      >
                        x
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Upload Evidence */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload Evidence</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file">File (max 10MB)</Label>
              <Input id="file" name="file" type="file" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                name="description"
                placeholder="Brief description of the evidence"
              />
            </div>
            <Button type="submit" disabled={uploading}>
              <Upload className="w-4 h-4 mr-2" />
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Evidence List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Evidence ({evidences.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {evidences.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No evidence uploaded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
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
                            onClick={() => handleDeleteEvidence(ev.id)}
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
