export type User = {
    name: string, 
    address: {city: string, zip: number}, 
    siblings: {
        name: string, 
        pets: {name: string, age: number}[]
    }[]
}
