import type { User } from './user.ts'
import type {WhereFilterDefinition} from './wherefilter.ts'

export type UserFilter = WhereFilterDefinition<User> // Resolves to: {name: string, 'address.city': string, 'address.zip': string}

