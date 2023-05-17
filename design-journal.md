# Design Journal

## Oops!

### The problem

Very embarassingly wrote "entity" when I meant "resource" early in the process
of creating this library and then carried that mistake forward with me for a
year. :joy: Renaming everywhere!

## Metadata

### The problem

Previous iterations of this library had separated the "value" of an entity,
which was established by the client, from the entity's metadata, which was
maintained by `sb-optimistic-entities` and including things like when the entity
was created and when it was last updated, for example. I liked this for a couple
of reasons:

1) If the client put it `{_id: "x", foo: "bar"}`, then they'd get out
   `{_id: "x", foo: "bar"}`, which keeps things simple.
2) Name-clashes are handled easily. User-specified fields and system fields are
   kept in entirely different "namespaces".

That said, those two namespaces need to live together in a single MongoDb
document, so a convention is required for separating them, and keeping that
convention transparent to the client becomes increasingly complicated the more
advanced MongoDb features you want to expose. In particular: how does the client
specify a sorting function first by "foo", then by "createdAt" if they live in
separate namespaces? How does the client include "createdAt" in a MongoDb
aggregation pipeline and how do we parse that pipeline to determine which things
are intended as instructions for MongoDb and which are intended as instructions
for us?

On the balance, I think the better compromise is to include metadata as
`sb-optimistic-entities`-managed fields that are first class members of an
entity's value, mirroring how MongoDb includes `_id` as part of a document's
value. This means the client can query, sort, and reason about these fields
using normal MongoDb constructs without intervention from us.

The downsides are:

1) If the client adds `{_id: "x", foo: "bar"}` they now get
back `{_id: "x", foo: "bar", ...some other stuff we added...}`
2) Field clashes are now a possibility and must be addressed.

While Number 1 is less than ideal, it's easily explained and mirrors what the
client is already accustomed to with MongoDb (after all, had they added
`{foo: "bar"}` they'd've gotten back `{_id: ObjectId(...), foo: "bar"}`).

Number 2 is more fraught, so let's work through some options:

### Potential solutions

#### Option 1: No collision-resistance

We could just add our `createdBy` alongside the client's `foo`. The biggest
problem here is future-proofing. If we want to add a field in the future, it
becomes a breaking change.

#### Option 2: Explicit client namespace

We could confine the user to editing a subtree rooted in some top level field.

```json
{
    "_id": "plugh",
    "createAt": "...",
    "value": {
        "foo": "bar"
    }
}
```

I don't love this for two reasons:

1) Many Mongo tools get clunky when working with structured data that lives
   below the top level. (Mongo Express, for example, displays individual columns
   for top-level fields, but then JSON.stringify()s structured data below the
   top-level.) So moving the client's data, which is the most important data,
   off the top level seems ill-advised.
2) The client's data is the data they'll want to query and manipulate the most,
   so adding a `value.` to every single attempt to access that data seems like a
   pain.

#### Option 3: Explicit system namespace

This is the inverse of Option 2.

```json
{
    "_id": "plugh",
    "$sboe": {
        "createdAt": "..."
    },
    "foo": "bar"
}
```

I don't love giving the user restrictions on what their keys can be, but with a
carefully-chosen top level field name, it's unlikely to matter.  Again we run
into the issue that many tools may treat the `$sboe` top level field as a blob.

#### Option 4: Prefix/Suffixed client values

I include this only for completeness as it's pretty clearly a bad idea. But in
previous iterations where we were actively munging names, we included top-level
client fields alongside metadata fields by prefixing them with `v_` for "value".

It seems like a non-starter to make the client prefix all their top level fields
with something like `c_`.

#### Option 5: Prefix/Suffixed system values

I think I favor this one.

`createdBy`, etc., could live alongside top-level client fields, suffixed by
`_sboe`. It's relatively ugly, but it keeps useful data at the top level where
it will be displayed and manipulated nicely by available tools, it's easy to
explain, and forbidding the user from using a suffix like that on their top
level fields shouldn't be burdensome.

### My verdict

In many ways it's the ugliest solution, but I think Option 5 has the most
reasonable tradeoffs, so I think I'll go with it for the moment.

## Delete mechanism

### The problem

As I'm building out `@shieldsbetter/relaxation` on top of this library, I need
to implement the `DELETE` verb, and for parity with the other mutation verbs,
I need to implement the `If-Match` and `If-None-Match` headers. At time of
writing, `deleteOne()` and `deleteMany()` in this library are implemented as
direct calls to the underlying Mongo collection's `deleteOne()` and
`deleteMany()`, which seems sensible. Under this regime, I might implement
`If-Match` and `If-None-Match` by simply adding an `expectedVersions` option as
`updateOne()` already has, and perhaps also an `unexpectedVersions` to allow for
`If-None-Match` (at which point, I would add `unexpectedVersions` to
`updateOne()` as well).

However, this straightforward implementation has a couple of drawbacks:

1) it will not be possible to distinguish "didn't delete because the `_id`
didn't exist" from "didn't delete because an unexpected version was
encountered". Arguably, one of these is a _success case_ (for idempotency,
deleting something that doesn't exist might succeed!) while the other is a
_failure case_, so not being able to distinguish them is spooky. Regardless, we
would ideally distinguish these cases to correctly implement the semantics of
`DELETE`. We could, however, perhaps simply treat both cases as an error.

2) no matter which way we resolve (1), delete's `expectedVersions` would behave
differently from update's `expectedVersions`.

An alternative would be to implement delete as a generalization of update--i.e.,
you attempt to delete a particular _version_ of the document, with the requisite
read-version-then-mutate flow. If another write changes the version of the
document out from beneath you, the delete fails and is retried. This allows not
only for an `expectedVersions` option that works _exactly_ like update's option,
but also opens up the possibility of aborting the delete based on generic
Javascript evaluation of the current value of the document.

The downsides to this approach are that `deleteMany()` becomes more complicated,
and that there is a significant performance penalty to delete.  This penalty
comes on two fronts: first, a delete now requires two round trips to the
database, roughly doubling the time; and second, delete now has the same
susceptibility to becoming starved during write-heavy periods as update, which
is probably relatively surprising to the client--it may not be possible to
delete an entity if that entity is "busy"!

### My verdict

I'm going to implement delete as a generalized update. That deletes were faster
than update was nice in an absolute sense, but this was an accident and an
accident that led to semantic weirdness. In particular, there's no particular
reason to imagine that deletes dominate updates in typical workloads (indeed,
it seems likely the opposite is true), and even if they do they are not _worse_
than updates under the generalized update regime, only worse than the accidental
naive delete implementation.

While it may be somewhat surprising to the client that deletes trigger an
optimistic lock, it is quickly and succinctly explained: "Updates and deletes
are both mutations--mutations trigger an optimistic lock."

## Return values

### The problem

So as I've married this more directly to MongoDb, I don't love that methods
named like MongoDb methods (e.g., `findOne()`) don't return things shaped like
what the equivalent MongoDb method returns. I.e., this library returns a
metadata record containing a `value` field rather than the entity value itself,
and if no such record exists, throws an exception rather than returning `null`.

That said, due to the nature of what we're doing, we're able to provide a much
more consistent interface--everything just returns the full record--which is
really nice and I hate to make _worse_ in order to make it consistent.

That said we can certainly imagine that in the future that will become more
complicated--factoring in projection, for example, after which we won't be able
to return the full document.

### Option 1: Just be different

I do like the current shape of things.

### Option 2: Offer both

Arguably there's no real downside to this one, other than we need to expose some
internals by returning what the underlying collection returns (i.e., our
`updateOne()` probably needs to return the result of the successful internal
`updateOne()`.)

Then we can have a separate `updateOneRecord()` that does the same thing but
returns the "better" return type.

### My verdict

I'll just offer both. I don't love it but there's no real downside and there's
certainly an upside to consistency. I'm building this on Mongo, so there's no
point in apologizing for Mongo.

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
