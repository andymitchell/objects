import { WriteAction, createWriteActionSchema } from "../write-actions/types";

type EnsureBidirectionalCompatibility<T1, T2> = [T1] extends [T2] ? [T2] extends [T1] ? true : false : false;
export default function isTypeEqual<T1, T2>(value: EnsureBidirectionalCompatibility<T1, T2> extends true ? true : never) {}
