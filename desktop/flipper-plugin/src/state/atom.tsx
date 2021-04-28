/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import {produce, Draft, enableMapSet} from 'immer';
import {useState, useEffect} from 'react';
import {Persistable, registerStorageAtom} from '../plugin/PluginBase';

enableMapSet();

export interface ReadOnlyAtom<T> {
  get(): T;
  subscribe(listener: (value: T, prevValue: T) => void): () => void;
  unsubscribe(listener: (value: T, prevValue: T) => void): void;
}

export interface Atom<T> extends ReadOnlyAtom<T> {
  set(newValue: T): void;
  update(recipe: (draft: Draft<T>) => void): void;
}

class AtomValue<T> implements Atom<T>, Persistable {
  value: T;
  listeners: ((value: T, prevValue: T) => void)[] = [];

  constructor(initialValue: T) {
    this.value = initialValue;
  }

  get() {
    return this.value;
  }

  set(nextValue: T) {
    if (nextValue !== this.value) {
      const prevValue = this.value;
      this.value = nextValue;
      this.notifyChanged(prevValue);
    }
  }

  deserialize(value: T) {
    this.set(value);
  }

  serialize() {
    return this.get();
  }

  update(recipe: (draft: Draft<T>) => void) {
    this.set(produce(this.value, recipe));
  }

  notifyChanged(prevValue: T) {
    // TODO: add scheduling
    this.listeners.slice().forEach((l) => l(this.value, prevValue));
  }

  subscribe(listener: (value: T, prevValue: T) => void) {
    this.listeners.push(listener);
    return () => this.unsubscribe(listener);
  }

  unsubscribe(listener: (value: T, prevValue: T) => void) {
    const idx = this.listeners.indexOf(listener);
    if (idx !== -1) {
      this.listeners.splice(idx, 1);
    }
  }
}

type StateOptions = {
  /**
   * Should this state persist when exporting a plugin?
   * If set, the atom will be saved / loaded under the key provided
   */
  persist?: string;
};

export function createState<T>(
  initialValue: T,
  options?: StateOptions,
): Atom<T>;
export function createState<T>(): Atom<T | undefined>;
export function createState(
  initialValue: any = undefined,
  options: StateOptions = {},
): Atom<any> {
  const atom = new AtomValue(initialValue);
  registerStorageAtom(options.persist, atom);
  return atom;
}

export function useValue<T>(atom: ReadOnlyAtom<T>): T;
export function useValue<T>(
  atom: ReadOnlyAtom<T> | undefined,
  defaultValue: T,
): T;
export function useValue<T>(
  atom: ReadOnlyAtom<T> | undefined,
  defaultValue?: T,
): T {
  const [localValue, setLocalValue] = useState<T>(
    atom ? atom.get() : defaultValue!,
  );
  useEffect(() => {
    if (!atom) {
      return;
    }
    // atom might have changed between mounting and effect setup
    // in that case, this will cause a re-render, otherwise not
    setLocalValue(atom.get());
    (atom as AtomValue<T>).subscribe(setLocalValue);
    return () => {
      (atom as AtomValue<T>).unsubscribe(setLocalValue);
    };
  }, [atom]);
  return localValue;
}

export function isAtom(value: any): value is Atom<any> {
  return value instanceof AtomValue;
}
