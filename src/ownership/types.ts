import type { DotPropPathsUnionScalarSpreadingObjectArrays, DotPropPathsUnionScalarArraySpreadingObjectArrays } from "../dot-prop-paths/types.ts";

export type OwnerIdFormat = 'uuid' | 'email';

export type OwnershipProperty<T extends Record<string, any> = Record<string, any>> =
    {
        property_type: 'id',
        path: DotPropPathsUnionScalarSpreadingObjectArrays<T>,
        format: OwnerIdFormat,
        /**
         * The person who will become the new owner, if they accept it.
         *
         * Gives complete editing power to this person (as well as the existing owner).
         */
        transferring_to_path?: DotPropPathsUnionScalarSpreadingObjectArrays<T>,
    } | {
        property_type: 'id_in_scalar_array',
        path: DotPropPathsUnionScalarArraySpreadingObjectArrays<T>,
        format: OwnerIdFormat,
    }

export type OwnershipRule<T extends Record<string, any> = Record<string, any>> =
    {
        /**
         * Only an owner can make changes to the object.
         *
         * Basic implementation with no granularity — use for simple single-owner or multi-owner scenarios.
         */
        type: 'basic',
    } & OwnershipProperty<T>
    | {
        /**
         * Anyone can make changes.
         */
        type: 'none',
    }
