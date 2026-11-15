export function createSpiceBridge(module, resetKernels) {
  function invoke(name, inputs, outputSizes) {
    const allocations = [];
    const allocate = size => {
      const pointer = module._malloc(size);
      if (!pointer) throw new Error('Not enough memory for the astronomical calculation.');
      allocations.push(pointer);
      return pointer;
    };
    try {
      const args = inputs.map(value => {
        if (typeof value !== 'string') {
          if (!Number.isFinite(value)) throw new Error('Invalid astronomical time.');
          return value;
        }
        const pointer = module.stringToNewUTF8(value);
        allocations.push(pointer);
        return pointer;
      });
      const outputs = outputSizes.map(size => allocate(size * 8));
      module[`_${name}_c`](...args, ...outputs);
      module.naifCheckErrors();
      return outputs.map((pointer, index) => Array.from(module.HEAPF64.subarray(pointer / 8, pointer / 8 + outputSizes[index])));
    } finally {
      allocations.forEach(pointer => module._free(pointer));
    }
  }
  function position(input, epoch) {
    const compute = () => {
      const [ptarg, light] = invoke('spkpos', [input.target, epoch, input.frame, input.correction, input.observer], [3, 1]);
      if (![...ptarg, light[0]].every(Number.isFinite)) throw new Error('The astronomical calculation produced invalid values.');
      return { ptarg, lt: light[0] };
    };
    try {
      return compute();
    } catch (error) {
      if (!String(error).includes('SPKINSUFFDATA')) throw error;
      resetKernels();
      return compute();
    }
  }
  return {
    request(payload) {
      const input = JSON.parse(payload);
      if (input.operation === 'str2et') return JSON.stringify(invoke('str2et', [input.value], [1])[0][0]);
      if (input.operation === 'spkpos') return JSON.stringify(input.epochs.map(epoch => position(input, epoch)));
      if (input.operation === 'pxfrm2') {
        const [values] = invoke('pxfrm2', [input.source, input.target, input.before, input.after], [9]);
        return JSON.stringify([values.slice(0, 3), values.slice(3, 6), values.slice(6, 9)]);
      }
      throw new Error('Unknown astronomical operation.');
    },
  };
}
