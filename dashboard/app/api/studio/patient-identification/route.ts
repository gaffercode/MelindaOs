import { PDFDocument } from "pdf-lib";
import { apiBoundary, DirectorApiError } from "@/lib/director/director-api";
import { studioActor } from "@/lib/studio/api";
import { assemblePackage } from "@/lib/studio/assemble-package";
import { loadRequirementRegister } from "@/lib/starkes/requirements";
import { loadStudioSourceSnapshot } from "@/lib/studio/source-snapshot";
import { buildStructuredStudioPdf } from "@/lib/pdf/build-studio-structured";
import { guard } from "@/lib/access/guard";

export const runtime = "nodejs";

export const POST = guard(async (request: Request) => {
  return apiBoundary(async () => {
    await studioActor(request, true);
    const source = await loadStudioSourceSnapshot();
    const register = loadRequirementRegister();
    const applicability = Object.fromEntries(
      register.requirements.filter((requirement) => requirement.standardCode === "SKP 1")
        .map((requirement) => [requirement.id, "applicable" as const]),
    );
    const pkg = assemblePackage({ packageKey: "identifikasi-pasien", source, register, applicability });
    // Document control assigns the number and date when the hospital issues the document.
    const blocker = pkg.issues.find((issue) => issue.severity === "blocker" &&
      !(issue.code === "publication_missing" && ["number", "issueDate"].includes(issue.field)));
    if (blocker) {
      const document = pkg.documents.find((doc) => doc.id === blocker.documentId);
      const sourceLabel = {
        identifikasi: "panduan identifikasi pasien",
        "tata-naskah": "pedoman tata naskah",
        "org-2026": "struktur organisasi rumah sakit",
      }[blocker.field as "identifikasi" | "tata-naskah" | "org-2026"];
      if (sourceLabel && ["source_unverified", "source_changed"].includes(blocker.code)) {
        throw new DirectorApiError(422, `Hubungi Tim Mutu untuk memverifikasi ${sourceLabel}, lalu klik Buat Dokumen kembali.`);
      }
      throw new DirectorApiError(422, `${document?.title ?? "Paket Identifikasi Pasien"}: ${blocker.message} Hubungi Tim Mutu untuk melengkapinya.`);
    }

    const binder = await PDFDocument.create();
    for (const doc of pkg.documents) {
      const pdf = await PDFDocument.load(await buildStructuredStudioPdf(doc, "manual-signature"));
      for (const page of await binder.copyPages(pdf, pdf.getPageIndices())) binder.addPage(page);
    }
    return new Response(Buffer.from(await binder.save()), { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="Paket_Identifikasi_Pasien.pdf"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  });
});
