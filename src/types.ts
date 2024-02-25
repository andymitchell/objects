export type EnsureRecord<T> = T extends Record<string, any> ? T : never;

export type IfAny<T, Y, N> = 0 extends (1 & T) ? Y : N;