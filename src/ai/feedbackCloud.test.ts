import { describe, expect, it } from "vitest";
import { mergeFeedback, type CloudRow, type FeedbackRow } from "./feedbackCloud";
import { encodeVec } from "./vecCodec";

const local = (id: string, at: number): FeedbackRow => ({ id, key: "a/1", english: "Anna", vote: 1, at, q: new Float32Array(0) });
const cloud = (id: string, at: number, deleted = false): CloudRow => ({ id, key: "a/1", english: "Anna", vote: 1, q: null, at, deleted });

describe("mergeFeedback", () => {
  it("holt gesicherte Namen zurück, wenn das Gerät leer ist (App neu installiert)", () => {
    const r = mergeFeedback([], [cloud("x", 5), { ...cloud("y", 6), q: encodeVec(new Float32Array([1, 0])) }]);
    expect(r.putLocal.map((f) => f.id)).toEqual(["x", "y"]);
    expect(r.putLocal[1].q.length).toBe(2);
    expect(r.upload).toEqual([]);
  });

  it("lädt Einträge hoch, die nur auf dem Gerät liegen", () => {
    expect(mergeFeedback([local("x", 5)], []).upload.map((f) => f.id)).toEqual(["x"]);
  });

  it("Löschen gilt auf allen Geräten – ausser es wurde danach lokal neu gesetzt", () => {
    expect(mergeFeedback([local("x", 5)], [cloud("x", 9, true)]).deleteLocal).toEqual(["x"]);
    const r = mergeFeedback([local("x", 12)], [cloud("x", 9, true)]);
    expect(r.deleteLocal).toEqual([]);
    expect(r.upload.map((f) => f.id)).toEqual(["x"]);
  });

  it("die neuere Seite gewinnt", () => {
    expect(mergeFeedback([local("x", 5)], [cloud("x", 9)]).putLocal.map((f) => f.at)).toEqual([9]);
    expect(mergeFeedback([local("x", 9)], [cloud("x", 5)]).upload.map((f) => f.at)).toEqual([9]);
    expect(mergeFeedback([local("x", 5)], [cloud("x", 5)])).toEqual({ putLocal: [], deleteLocal: [], upload: [] });
  });
});
