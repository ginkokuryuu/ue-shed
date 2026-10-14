import { Flag } from "effect/cli";
import { Option } from "effect";

export function optionalFlag(name: string) {
	return Flag.String(name).pipe(Flag.optional);
}

export function optionalValue<A>(value: Option.Option<A>): A | undefined {
	return Option.isSome(value) ? value.value : undefined;
}

export function readerFields(reader: Option.Option<string>) {
	const value = optionalValue(reader);
	return value === undefined ? {} : { reader: value };
}

export function positiveIntegerFlag(name: string, message: string) {
	return Flag.Int(name).pipe(
		Flag.filter(
			(value) => value > 0,
			() => message
		)
	);
}

export function nonNegativeIntegerFlag(name: string, message: string) {
	return Flag.Int(name).pipe(
		Flag.filter(
			(value) => value >= 0,
			() => message
		)
	);
}
