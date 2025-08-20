/**
 * LRU Cache implementation to replace unbounded Maps
 * Based on OpenAI memory optimization recommendations
 */

interface CacheNode<T> {
  key: string;
  value: T;
  prev?: CacheNode<T>;
  next?: CacheNode<T>;
  timestamp: number;
}

export class LRUCache<T> {
  private capacity: number;
  private cache = new Map<string, CacheNode<T>>();
  private head?: CacheNode<T>;
  private tail?: CacheNode<T>;
  private ttl: number; // Time to live in milliseconds

  constructor(capacity: number, ttlMs = 5 * 60 * 1000) { // Default 5 minutes TTL
    this.capacity = capacity;
    this.ttl = ttlMs;
  }

  get(key: string): T | undefined {
    const node = this.cache.get(key);
    if (!node) return undefined;

    // Check if expired
    if (Date.now() - node.timestamp > this.ttl) {
      this.delete(key);
      return undefined;
    }

    // Move to head (most recently used)
    this.moveToHead(node);
    return node.value;
  }

  set(key: string, value: T): void {
    const existingNode = this.cache.get(key);
    
    if (existingNode) {
      // Update existing node
      existingNode.value = value;
      existingNode.timestamp = Date.now();
      this.moveToHead(existingNode);
      return;
    }

    // Create new node
    const newNode: CacheNode<T> = {
      key,
      value,
      timestamp: Date.now()
    };

    // Add to cache
    this.cache.set(key, newNode);
    this.addToHead(newNode);

    // Check capacity
    if (this.cache.size > this.capacity) {
      this.removeTail();
    }
  }

  delete(key: string): boolean {
    const node = this.cache.get(key);
    if (!node) return false;

    this.cache.delete(key);
    this.removeNode(node);
    return true;
  }

  clear(): void {
    this.cache.clear();
    this.head = undefined;
    this.tail = undefined;
  }

  size(): number {
    return this.cache.size;
  }

  // Clean expired entries
  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    
    const entries = Array.from(this.cache.entries());
    for (const [key, node] of entries) {
      if (now - node.timestamp > this.ttl) {
        this.delete(key);
        removed++;
      }
    }
    
    return removed;
  }

  private addToHead(node: CacheNode<T>): void {
    node.prev = undefined;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: CacheNode<T>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  private moveToHead(node: CacheNode<T>): void {
    this.removeNode(node);
    this.addToHead(node);
  }

  private removeTail(): void {
    if (!this.tail) return;
    
    const key = this.tail.key;
    this.removeNode(this.tail);
    this.cache.delete(key);
  }
}