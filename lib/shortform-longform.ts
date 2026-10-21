/** A durable reference to an OS final; signed addresses are never saved as source files. */
export interface ShortformLongformRef {
  kind: "os_longform_v1";
  runId: string;
  key: string;
}

export interface ShortformLongformInput {
  reference: ShortformLongformRef;
  videoUrl: string;
  transcript: string;
  durationSeconds: number;
  expiresIn: number;
}
