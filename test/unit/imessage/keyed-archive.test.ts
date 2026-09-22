import { describe, expect, it } from "vitest";
import { UID } from "bplist-parser";
import { isKeyedArchive, resolveKeyedArchiveRoot } from "../../../src/ingest/imessage/keyed-archive";

// These construct the JS object shape bplist-parser produces after
// decoding real NSKeyedArchiver bytes (UID instances for object
// references, a $objects array, etc.) rather than encoding real binary
// plists — bplist-parser's own decoding is trusted upstream behavior;
// what's under test here is resolving the archive graph it hands back.

describe("isKeyedArchive", () => {
  it("recognizes a well-formed NSKeyedArchiver top-level dict", () => {
    expect(isKeyedArchive({ $archiver: "NSKeyedArchiver", $objects: ["$null"] })).toBe(true);
  });

  it("rejects a plain bplist dict", () => {
    expect(isKeyedArchive({ someKey: "someValue" })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isKeyedArchive("a string")).toBe(false);
    expect(isKeyedArchive(null)).toBe(false);
  });
});

describe("resolveKeyedArchiveRoot", () => {
  it("resolves a root object that's an NSString via NS.string", () => {
    const archive = {
      $archiver: "NSKeyedArchiver",
      $top: { root: new UID(1) },
      $objects: ["$null", { "NS.string": "hello" }],
    };
    expect(resolveKeyedArchiveRoot(archive)).toBe("hello");
  });

  it("resolves an NSArray via NS.objects", () => {
    const archive = {
      $archiver: "NSKeyedArchiver",
      $top: { root: new UID(1) },
      $objects: ["$null", { "NS.objects": [new UID(2), new UID(3)] }, "first", "second"],
    };
    expect(resolveKeyedArchiveRoot(archive)).toEqual(["first", "second"]);
  });

  it("resolves an NSDictionary via parallel NS.keys / NS.objects", () => {
    const archive = {
      $archiver: "NSKeyedArchiver",
      $top: { root: new UID(1) },
      $objects: ["$null", { "NS.keys": [new UID(2)], "NS.objects": [new UID(3)] }, "myKey", "myValue"],
    };
    expect(resolveKeyedArchiveRoot(archive)).toEqual({ myKey: "myValue" });
  });

  it("resolves a generic archived object, dropping $class", () => {
    const archive = {
      $archiver: "NSKeyedArchiver",
      $top: { root: new UID(1) },
      $objects: ["$null", { $class: new UID(2), ec: [new UID(3)] }, { $classname: "SomeClass" }, "edit content"],
    };
    expect(resolveKeyedArchiveRoot(archive)).toEqual({ ec: ["edit content"] });
  });

  it("handles a cycle in the object graph without recursing forever", () => {
    const archive = {
      $archiver: "NSKeyedArchiver",
      $top: { root: new UID(1) },
      $objects: ["$null", { self: new UID(1) }],
    };
    expect(resolveKeyedArchiveRoot(archive)).toEqual({ self: "$circular-reference" });
  });

  it("treats $null as null", () => {
    const archive = {
      $archiver: "NSKeyedArchiver",
      $top: { root: new UID(1) },
      $objects: ["$null", { maybe: new UID(0) }],
    };
    expect(resolveKeyedArchiveRoot(archive)).toEqual({ maybe: null });
  });
});
