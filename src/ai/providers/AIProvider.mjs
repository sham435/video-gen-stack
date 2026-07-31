export class AIProvider {
  async generate(prompt, options = {}) {
    throw new Error('generate() must be implemented by subclass')
  }

  get name() {
    return this.constructor.name
  }

  get supportedFeatures() {
    return ['chat']
  }
}
