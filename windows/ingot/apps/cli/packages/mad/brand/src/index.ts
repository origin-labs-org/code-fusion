/**
 * Nominal branding primitives shared by the MAD packages.
 *
 * A `Branded` id is a string at runtime and a distinct type at compile time, so ids from
 * different domains cannot be mixed accidentally.
 */
export type Branded<B extends string> = string & { readonly __brand: B };

export function brand<B extends string>(value: string): Branded<B> {
  return value as Branded<B>;
}
