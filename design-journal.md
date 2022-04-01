# Design Journal

## Rethinking vocabulary

### The problem

Ideally, we'd just call the value you shove into Mongo through this library a
"document" for consistency with Mongo's terminology. But that leads to something
I think is a confusing mismatch:

The client's logical document might be `{ _id: "foo", bar: "barval" }`, but the
document as stored in Mongo might look like `{ _id: "foo", createdAt: 123,
updatedAt: 123, version: "abcdef", v_bar: "barval", m_bazz: "bazzmetaval" }`. So
there are two ideas of "document" in play.

Do we try to just be really consistent about referring to these as the "Mongo
document" and the "logical document"? If so, it would be helpful to have a
_name_ for this library so that we can call them the "Mongo document" and the
"Foo document", but any descriptive name would be a mouthful, "Mongo Optimistic
Locking Library Document" vs "Mongo Document" is both wordy and still seems open
to confusion. Also, "client document" and "logical document" quickly fall down
for the usual reason that one person's client/logical is another person's
server/physical.

My initial impulse was to establish a "second level" vocabulary for client
objects and I naively landed on the word "cartridge" for the client's logical
document, since you always retrieve it as a whole, "pop it out", modify it, then
write it back. It's not a perfect metaphor--"popping out" the cartridge doesn't
actually "lock" it, but maybe it's good enough?

But additionally, the actual structure given back to you by the library is
currently shaped like: `{ createdAt, metadata, updatedAt, value, version }`. Is
that structure the cartridge? Or should `value` be renamed `cartridge` and this
is simply the result object? Is this not all metadata? What do we call the stuff
currently stored in `metadata`? The `metacartridge`?

An alternative might be to choose a suggestive adjective to go with "document".
Given that the impulse here is to aid rapid prototyping by allowing you to
"never leave javascript", we could imagine referring to the client document as
the "hydrated document" or the "active document", with the corresponding Mongo
document being the "frozen document" or the "document of record". We might even
just refer to the client document as "The POJO" and the Mongo doc as the "Mongo
document".

We could just invent some terminology. Perhaps the client doc is the "optdoc"
(optimistic document?) with the corresponding Mongo doc simply the "Mongo doc"?

Given that my immediate plan for this library is as a bridge between REST APIs
and the database (for easy application of JSON-patches, etc.), perhaps we call
the client document the "entity value", which happens to be constrained to be
Mongo-like. I don't hate that. This library could be the "sb-optimistic-entity",
you work with entity values in an entity collection, backed by Mongo docs in a
Mongo collection.

Still should probably rename metadata. Probably it should simply be removed--
it's a useful feature, but unrelated to the optimistic locking and easy to layer
in later.

### My verdict

I'm going to call this `sb-optimistic-entities`. The client will work with
_entity values_ that are recorded as Mongo docs. I'm removing metadata
altogether--it's confusing and unrelated to the core functionality.

## Versioning under replacement and deletion

### The problem

At time of this writing, I'm using sequential version numbers for cartridge
value versioning. But now I'm confronting cartridge replacement and wondering
how to handle that. Naively, "replacement" should be semantically equivalent to
a _delete_ followed by an _insert_, and certainly in such a case I'd imagine
that the new cartridge then resets its version to version 1. I.e., the data
model traces this sequence:

```
// Time 1: someKey doesn't map to anything
someKey -> undefined

// Time 2: We perform an insert
someKey -> { ...someData, version: 1 }

// Time 3: And an update
someKey -> { ...someUpdate(someData), version: 2 }

// Time 4: And now a replacement
someKey -> undefined                         // Time 4A: semantic delete
someKey -> { ...someNewData, version: 1 }    // Time 4B: semantic insert
```

But a parallel update operating at Time 2 will read version 1, and if it only
seeks to apply its optimistic update at Time 4, it will succeed when it ought to
fail and thus clobber the update that happened at Time 3 on the basis of
Time 2's stale data.

### Potential solutions

Some obvious alternatives present themselves:

#### Option 1: Version applies to the slot not the cartridge

So, implicitly, we understand that all undefined keys really represent:

```
undefinedKey -> { version: 0, /* with no data */ }
```

Thus the replacement above is _not_ a semantic delete + semantic insert, and
Time 4 looks like:

```
// Time 4: And now a replacement
someKey -> { ...someNewData, version: 3 }
```

But we still must account for deletes and they can't return to undefined
(otherwise we lose track of their version), so a delete at Time 5 looks like:

```
// Time 5: And now a deletion
someKey -> { version: 4, /* with no data */ }
```

Nothing exactly wrong here, but a couple cons:

1) We can never actually delete a key from the database (could be bad in
   high-transient-data scenarios. Certainly counter-intuitive)
2) We now have some weirdness orbitting "empty slot" vs.
  "non-empty slot with empty value", namely we either eliminate the idea of
  "empty slot" in favor of "all slots are non-empty, but by default all have
  empty value" (I think this strikes mathematicians as graceful but is
  counterintuitive to human beings) _or_ we add some extra machinery to track
  "this space intentionally left blank" vs. "this represents the empty value",
  which isn't a disaster but leaves us with two different representations of
  an empty slot

#### Option 2: Version is a random uuid

Now our time sequence looks like:

```
// Time 1: someKey doesn't map to anything
someKey -> undefined

// Time 2: We perform an insert
someKey -> { ...someData, version: uuid1 }

// Time 3: And an update
someKey -> { ...someUpdate(someData), version: uuid2 }

// Time 4: And now a replacement
someKey -> undefined                             // Time 4A: semantic delete
someKey -> { ...someNewData, version: uuid3 }    // Time 4B: semantic insert
```

We no longer have the lost-update problem initially presented. We intuitively
delete representations from the database when the cartridge is deleted and we
have a single representation for empty slots. There remains an odd case
operating on empty slots, though. Consider this time sequence:

```
// Time 1: empty slot
someKey -> undefined

// Time 2: insert
someKey -> { ...someData, version: uuid1 }

// Time 3: delete
someKey -> undefined
```

A parallel update operating at Time 1 will read an empty slot, and if it only
seeks to apply its optimistic update at Time 3, that update will succeed. It is
not clear if it _ought_ to succeed or not. If instead of sharing the undefined
value, Time 1 and Time 3 shared some defined value, we would imagine they had
different uuids and the update would fail. It seems unintuitive for these
situations to operate differently, but perhaps it's intuitive enough for
`undefined` to be treated specially. After all, we permit the value `{}`
separately as a defined value. Thus empty slots are special and if the user
wants the other behavior, they can use a non-empty slot with empty value.

I don't hate this set of tradeoffs.

#### Option 3: Version is a hash, updates are considered "pure"

I don't like this option, so I'm just going to give a gloss, but I'd like to
register that it was considered. Basically, under this model optimistic locking
succeeds so long as the _value_ of the cartridge is unchanged from the start of
the locking process to the application of the update, regardless of whether or
not there were intervening operations on the slot that may have included the
value potentially changing and then changing back. _undefined_ then becomes a
non-special value, which is a nice upshot, but:

1) hashes could be relatively expensive to calculate compared to incrementing
   version numbers or random uuids, and probably more importantly,
2) pure updates are almost certainly a fantasy in real-world application

### My verdict

I'm going with option 2 for now. Random uuids seem to give the best set of
tradeoffs. I don't _love_ that "empty slot" is "special" w.r.t. locking, but I
think it's relatively intuitive and I like it better than leaving
counterintuitive tombstones for deleted data.
