import safeKeyValue from "../../getKeyValue";
import { AppliedWritesOutput } from "../types";
import { ItemHash } from "./types";


export default function applyAccumulatorToHashes<T>(accumulator:AppliedWritesOutput<T>, primary_key: keyof T, addedHash:ItemHash<T>, updatedHash:ItemHash<T>, deletedHash:ItemHash<T>) {
    const io: [T[], ItemHash<T>][] = [
        [accumulator.added, addedHash],
        [accumulator.updated, updatedHash],
        [accumulator.deleted, deletedHash]
    ];
    io.forEach(transform => {
        const items = transform[0];
        const itemHash = transform[1];
        for (const item of items) itemHash[safeKeyValue(item[primary_key])] = item;
    })
}